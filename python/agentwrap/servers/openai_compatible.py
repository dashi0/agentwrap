"""
OpenAI Compatible Server

Adapts any BaseAgent implementation to provide OpenAI Chat Completion
compatible interface.
"""

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from fastapi import Request, Response
from fastapi.responses import StreamingResponse

from ..agent import BaseAgent
from ..base_server import BaseServer, ToolCall
from ..config import AgentInput, AllAgentConfigs
from ..prompts import Prompts
from ..events import (
    CommandExecutionEvent,
    MessageEvent,
    ReasoningEvent,
    SkillInvokedEvent,
)
from ..server.types import (
    ChatCompletionAssistantMessage,
    ChatCompletionChoice,
    ChatCompletionFunction,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionToolCall,
)


@dataclass
class OpenAIServerOptions:
    """Options for OpenAI compatible server."""

    mcp_server_port: int = 0  # 0 = random port
    mcp_server_host: str = "127.0.0.1"
    termination_delay_ms: int = 2000
    bypass_request: Optional[
        Callable[[ChatCompletionRequest, Request, Response], bool]
    ] = None


class OpenAICompatibleServer(BaseServer[ChatCompletionRequest, ChatCompletionResponse]):
    """
    OpenAI Compatible Server - Adapts any agent to OpenAI Chat Completion API

    Example usage:
    ```python
    agent = CodexAgent()
    await agent.configure(config)

    server = OpenAICompatibleServer(agent)
    response = await server.handle_request(request)
    ```

    THREAD SAFETY:
    - Inherits thread-safe state management from BaseServer
    - Function calling uses global dynamic MCP bridge (thread-safe)
    """

    def __init__(self, agent: BaseAgent, options: Optional[OpenAIServerOptions] = None):
        """Initialize server."""
        super().__init__()
        self.agent = agent
        if options is None:
            options = OpenAIServerOptions()
        self.mcp_server_port = options.mcp_server_port
        self.mcp_server_host = options.mcp_server_host
        self.termination_delay_ms = options.termination_delay_ms
        self.bypass_request = options.bypass_request
        self.prompts = Prompts()

    def register_routes(self, app):
        """Register OpenAI-specific HTTP routes."""

        @app.post("/v1/chat/completions")
        async def chat_completions(request: Request):
            try:
                body = await request.json()
                chat_request = self._parse_request(body)

                # Optional bypass: call bypass_request if provided
                if self.bypass_request:
                    response = Response()
                    bypassed = await self.bypass_request(chat_request, request, response)
                    if bypassed:
                        return response

                # Handle request (supports both streaming and non-streaming)
                return await self.handle_request(chat_request)

            except Exception as error:
                print(f"[OpenAICompatibleServer] Error: {error}")
                return {
                    "error": {
                        "message": str(error),
                        "type": "internal_error",
                        "code": "internal_error",
                    }
                }

    async def handle_request(
        self, request: ChatCompletionRequest, response: Optional[Response] = None
    ) -> ChatCompletionResponse:
        """
        Handle OpenAI Chat Completion request.

        This method uses a unified processing path for all requests:
        1. If functions are provided, sets up MCP bridge conditionally
        2. Runs agent with unified event processing
        3. Returns tool_calls response if functions were called, otherwise normal response
        4. Supports both streaming and non-streaming modes
        """
        # Extract functions (if any)
        functions = self._extract_functions(request)
        is_streaming = request.stream
        response_id = f"chatcmpl-{uuid.uuid4()}"
        created = int(time.time())

        # Setup MCP bridge conditionally if functions are provided
        mcp_context = None
        config_overrides = None
        terminated = False
        tool_calls_result = []

        if functions:
            from ..server.dynamic_mcp_bridge import dynamic_mcp_bridge

            # Register request with dynamic MCP bridge
            mcp_context = dynamic_mcp_bridge.register_request(functions)

            # Ensure MCP server is started
            port = await dynamic_mcp_bridge.ensure_server_started(
                self.mcp_server_host, self.mcp_server_port
            )

            print(
                f"[OpenAICompatibleServer] Using dynamic MCP bridge on "
                f"{self.mcp_server_host}:{port}"
            )
            print(
                f"[OpenAICompatibleServer] Request {mcp_context.request_id} functions: "
                f"{[f['name'] for f in functions]}"
            )

            # Create temporary dynamic MCP skill
            dynamic_mcp_skill = {
                "type": "mcp",
                "transport": "sse",
                "url": f"http://{self.mcp_server_host}:{port}",
                "name": Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME,
            }

            # Build configOverrides with dynamic MCP skill
            config_overrides = AllAgentConfigs.from_dict(
                {
                    "agent_config": {"type": "codex-agent"},
                    "skills": [dynamic_mcp_skill],
                }
            )

            # Setup termination handler
            def on_terminate(tool_calls):
                nonlocal terminated, tool_calls_result
                terminated = True
                tool_calls_result = tool_calls

            mcp_context.mcp_server.on_terminate(on_terminate)

        # Convert request to prompt (with tool calling instructions if functions are provided)
        base_prompt = self.convert_request_to_prompt(request)
        if functions and mcp_context:
            prompt = self.prompts.prepend_tool_calling_instructions(
                base_prompt, functions, mcp_context.request_id
            )
        else:
            prompt = base_prompt
        agent_input = AgentInput.from_query(prompt)

        collected_content: List[str] = []

        async def generate_stream():
            """Generator for streaming response."""
            nonlocal terminated
            try:
                # Send initial chunk with role
                yield f"data: {json.dumps({
                    'id': response_id,
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': request.model,
                    'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]
                })}\n\n"

                # ===== Unified event processing (streaming vs non-streaming, with or without functions) =====
                for event in self.agent.run(agent_input, config_overrides):
                    # Check if terminated (function calling completed)
                    if terminated:
                        print("[OpenAICompatibleServer] Function calls detected, stopping event processing")
                        break

                    content_chunk = self._convert_event_to_content_chunk(event)
                    if content_chunk:
                        # Collect message content for final response
                        if isinstance(event, MessageEvent):
                            collected_content.append(content_chunk)

                        # Stream the chunk
                        yield f"data: {json.dumps({
                            'id': response_id,
                            'object': 'chat.completion.chunk',
                            'created': created,
                            'model': request.model,
                            'choices': [{'index': 0, 'delta': {'content': content_chunk}, 'finish_reason': None}]
                        })}\n\n"

                # Send final chunk based on whether functions were called
                finish_reason = 'tool_calls' if terminated else 'stop'
                yield f"data: {json.dumps({
                    'id': response_id,
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': request.model,
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish_reason}]
                })}\n\n"
                yield "data: [DONE]\n\n"

            except Exception as error:
                print(f"[OpenAICompatibleServer] Streaming error: {error}")
                yield f"data: {json.dumps({'error': {'message': str(error), 'type': 'internal_error'}})}\n\n"

        try:
            # For streaming, return StreamingResponse
            if is_streaming:
                return StreamingResponse(
                    generate_stream(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                    },
                )

            # For non-streaming, process events synchronously
            for event in self.agent.run(agent_input, config_overrides):
                # Check if terminated (function calling completed)
                if terminated:
                    print("[OpenAICompatibleServer] Function calls detected, stopping event processing")
                    break

                content_chunk = self._convert_event_to_content_chunk(event)
                if content_chunk:
                    # Collect message content for final response
                    if isinstance(event, MessageEvent):
                        collected_content.append(content_chunk)

            # Return response based on whether functions were called
            if terminated and mcp_context:
                # Function calls were made - return tool_calls response
                from ..server.dynamic_mcp_bridge import dynamic_mcp_bridge

                tool_calls = mcp_context.mcp_server.get_tool_calls()

                # Remove prefix from function names before returning
                original_tool_calls = [
                    ToolCall(
                        id=tc.id,
                        function={
                            "name": dynamic_mcp_bridge.remove_function_prefix(
                                tc.function["name"]
                            ),
                            "arguments": tc.function["arguments"],
                        },
                    )
                    for tc in tool_calls
                ]

                return self.create_tool_call_response(request, original_tool_calls)
            else:
                # Normal response - no function calls
                content = "".join(collected_content)
                return self.create_normal_response(request, content)

        finally:
            # Cleanup: unregister request (but keep dynamic MCP bridge running)
            if mcp_context:
                from ..server.dynamic_mcp_bridge import dynamic_mcp_bridge

                dynamic_mcp_bridge.unregister_request(mcp_context.request_id)

    def _convert_event_to_content_chunk(self, event) -> Optional[str]:
        """
        Convert agent event to content chunk.
        Extracted to avoid duplication in event processing loops.
        """
        if isinstance(event, ReasoningEvent):
            return f"[Reasoning] {event.content}\n"
        elif isinstance(event, CommandExecutionEvent):
            output_part = f"{event.output}\n" if event.output else ""
            return f"[Command] {event.command}\n{output_part}"
        elif isinstance(event, SkillInvokedEvent):
            return f"[Skill] {event.skill_name}\n"
        elif isinstance(event, MessageEvent):
            return event.content
        return None

    def _extract_functions(self, request: ChatCompletionRequest) -> List[Dict[str, Any]]:
        """Extract function definitions from request."""
        functions: List[Dict[str, Any]] = []

        # New tools format
        if request.tools:
            for tool in request.tools:
                if tool.type == "function" and tool.function:
                    functions.append(tool.function.to_dict())

        # Legacy functions format
        if request.functions:
            functions.extend(request.functions)

        return functions

    def convert_request_to_prompt(self, request: ChatCompletionRequest) -> str:
        """Convert OpenAI request to prompt string."""
        # Use Prompts class to handle tool_calls properly
        return self.prompts.function_call_history_to_prompt(request.messages)

    def create_tool_call_response(
        self, request: ChatCompletionRequest, tool_calls: List[ToolCall]
    ) -> ChatCompletionResponse:
        """Create OpenAI function call response."""
        response_id = f"chatcmpl-{uuid.uuid4()}"
        created = int(time.time())

        # Convert to OpenAI format tool calls
        openai_tool_calls = [
            ChatCompletionToolCall(
                id=tc.id,
                type="function",
                function=tc.function,
            )
            for tc in tool_calls
        ]

        assistant_message = ChatCompletionAssistantMessage(
            role="assistant", content=None, tool_calls=openai_tool_calls
        )

        choice = ChatCompletionChoice(
            index=0, message=assistant_message, finish_reason="tool_calls"
        )

        return ChatCompletionResponse(
            id=response_id,
            object="chat.completion",
            created=created,
            model=request.model,
            choices=[choice],
        )

    def create_normal_response(
        self, request: ChatCompletionRequest, content: str
    ) -> ChatCompletionResponse:
        """Create OpenAI normal response."""
        response_id = f"chatcmpl-{uuid.uuid4()}"
        created = int(time.time())

        assistant_message = ChatCompletionAssistantMessage(role="assistant", content=content)

        choice = ChatCompletionChoice(
            index=0, message=assistant_message, finish_reason="stop"
        )

        return ChatCompletionResponse(
            id=response_id,
            object="chat.completion",
            created=created,
            model=request.model,
            choices=[choice],
        )

    def _parse_request(self, body: Dict[str, Any]) -> ChatCompletionRequest:
        """Parse request body into ChatCompletionRequest."""
        return ChatCompletionRequest(
            model=body.get("model", "agentwrap-codex"),
            messages=body.get("messages", []),
            tools=body.get("tools"),
            tool_choice=body.get("tool_choice"),
            functions=body.get("functions"),
            function_call=body.get("function_call"),
            stream=body.get("stream", False),
            temperature=body.get("temperature"),
            max_tokens=body.get("max_tokens"),
        )
