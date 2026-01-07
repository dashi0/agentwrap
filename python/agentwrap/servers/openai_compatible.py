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

        This method:
        1. Checks if streaming is requested
        2. For streaming: returns StreamingResponse with SSE chunks
        3. For non-streaming: returns ChatCompletionResponse
        4. Handles function calling if tools/functions are provided
        """
        # Check for function calling - uses different logic
        functions = self._extract_functions(request)
        if functions:
            return await self._handle_with_function_calls(request, functions)

        # ===== Unified event processing (streaming vs non-streaming) =====
        is_streaming = request.stream
        response_id = f"chatcmpl-{uuid.uuid4()}"
        created = int(time.time())

        # Convert request to prompt and run agent
        prompt = self.convert_request_to_prompt(request)
        agent_input = AgentInput.from_query(prompt)

        collected_content: List[str] = []

        async def generate_stream():
            """Generator for streaming response."""
            try:
                # Send initial chunk with role
                yield f"data: {json.dumps({
                    'id': response_id,
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': request.model,
                    'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]
                })}\n\n"

                # Process events
                for event in self.agent.run(agent_input):
                    content_chunk = None

                    # Convert event to content
                    if isinstance(event, ReasoningEvent):
                        content_chunk = f"[Reasoning] {event.content}\n"
                    elif isinstance(event, CommandExecutionEvent):
                        content_chunk = f"[Command] {event.command}\n"
                        if event.output:
                            content_chunk += f"{event.output}\n"
                    elif isinstance(event, SkillInvokedEvent):
                        content_chunk = f"[Skill] {event.skill_name}\n"
                    elif isinstance(event, MessageEvent):
                        content_chunk = event.content
                        # Collect for final response
                        collected_content.append(content_chunk or "")

                    if content_chunk:
                        # Stream the chunk
                        yield f"data: {json.dumps({
                            'id': response_id,
                            'object': 'chat.completion.chunk',
                            'created': created,
                            'model': request.model,
                            'choices': [{'index': 0, 'delta': {'content': content_chunk}, 'finish_reason': None}]
                        })}\n\n"

                # Send final chunk
                yield f"data: {json.dumps({
                    'id': response_id,
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': request.model,
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]
                })}\n\n"
                yield "data: [DONE]\n\n"

            except Exception as error:
                print(f"[OpenAICompatibleServer] Streaming error: {error}")
                yield f"data: {json.dumps({'error': {'message': str(error), 'type': 'internal_error'}})}\n\n"

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

        # For non-streaming, collect all content
        for event in self.agent.run(agent_input):
            if isinstance(event, MessageEvent):
                collected_content.append(event.content or "")

        content = "".join(collected_content)
        return self.create_normal_response(request, content)

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
        # Simple conversion for now - just concatenate messages
        prompt_parts = []
        for msg in request.messages:
            if isinstance(msg, dict):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                prompt_parts.append(f"{role}: {content}")
            else:
                prompt_parts.append(str(msg))

        return "\n\n".join(prompt_parts)

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

    async def _handle_with_function_calls(
        self, request: ChatCompletionRequest, functions: List[Dict[str, Any]]
    ) -> ChatCompletionResponse:
        """
        Handle request with function calls.

        Uses Dynamic MCP Bridge to enable codex-cli to call user-defined functions.
        """
        from ..server.dynamic_mcp_bridge import dynamic_mcp_bridge

        if not self.agent:
            raise RuntimeError("Agent not set")

        # Register request with dynamic MCP bridge (adds suffix to function names)
        context = dynamic_mcp_bridge.register_request(functions)

        # Ensure dynamic MCP bridge HTTP server is started
        port = await dynamic_mcp_bridge.ensure_server_started(
            self.mcp_server_host, self.mcp_server_port
        )

        try:
            print(
                f"[OpenAICompatibleServer] Using dynamic MCP bridge on "
                f"{self.mcp_server_host}:{port}"
            )
            print(
                f"[OpenAICompatibleServer] Request {context.request_id} functions: "
                f"{[f['name'] for f in functions]}"
            )

            # Convert request to prompt
            prompt = self.convert_request_to_prompt(request)
            agent_input = AgentInput.from_query(prompt)

            # Create temporary dynamic MCP skill for function calling
            # This is NOT written to config file, only passed via configOverrides
            dynamic_mcp_skill = {
                "type": "mcp",
                "transport": "sse",
                "url": f"http://{self.mcp_server_host}:{port}",
            }

            # Build configOverrides with dynamic MCP skill
            config_overrides = AllAgentConfigs.from_dict(
                {
                    "agent_config": {"type": "codex-agent"},
                    "skills": [dynamic_mcp_skill],
                }
            )

            # Set up termination handler
            terminated = False
            tool_calls_result = []

            def on_terminate(tool_calls):
                nonlocal terminated, tool_calls_result
                terminated = True
                tool_calls_result = tool_calls

            context.mcp_server.on_terminate(on_terminate)

            # Run agent with configOverrides (dynamic MCP passed via -c flags)
            # Use a thread to run agent and wait for either completion or termination
            import threading
            import queue

            result_queue = queue.Queue()

            def run_agent_thread():
                try:
                    content = ""
                    for event in self.agent.run(agent_input, config_overrides):
                        if isinstance(event, MessageEvent):
                            content += event.content or ""
                    result_queue.put(("content", content))
                except Exception as e:
                    result_queue.put(("error", str(e)))

            agent_thread = threading.Thread(target=run_agent_thread)
            agent_thread.start()

            # Wait for either termination event or agent completion
            context.mcp_server.termination_event.wait(timeout=30)

            if context.mcp_server.termination_event.is_set():
                # Terminated (function calls detected)
                tool_calls = context.mcp_server.get_tool_calls()

                # Remove suffix from function names before returning
                original_tool_calls = [
                    ToolCall(
                        id=tc.id,
                        function={
                            "name": dynamic_mcp_bridge.remove_function_suffix(
                                tc.function["name"]
                            ),
                            "arguments": tc.function["arguments"],
                        },
                    )
                    for tc in tool_calls
                ]

                return self.create_tool_call_response(request, original_tool_calls)
            else:
                # Agent completed normally, get result from queue
                try:
                    result_type, result_value = result_queue.get(timeout=1)
                    if result_type == "content":
                        return self.create_normal_response(request, result_value)
                    else:
                        raise RuntimeError(f"Agent error: {result_value}")
                except queue.Empty:
                    return self.create_normal_response(request, "Agent timed out")

        finally:
            # Cleanup: unregister request (but keep dynamic MCP bridge running)
            dynamic_mcp_bridge.unregister_request(context.request_id)

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
