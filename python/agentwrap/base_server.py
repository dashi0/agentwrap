"""
Base Server Interface

Similar to BaseAgent, this defines the interface that all server
implementations must follow.

A server adapts an agent to provide a specific API format.
Examples: OpenAI Chat Completion API, Anthropic Messages API, etc.

Provides both in-process usage (via handle_request()) and HTTP server
capabilities with common routes.
"""

import asyncio
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Dict, Generic, Optional, TypeVar

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from .agent import BaseAgent
from .config import AgentInput, AllAgentConfigs
from .events import EventType, MessageEvent

TRequest = TypeVar("TRequest")
TResponse = TypeVar("TResponse")


@dataclass
class HttpServerOptions:
    """Options for HTTP server."""

    port: int = 3000
    host: str = "0.0.0.0"


@dataclass
class FunctionCallingOptions:
    """Options for function calling."""

    mcp_server_host: str = "127.0.0.1"
    mcp_server_port: int = 0  # 0 = random port


@dataclass
class ToolCall:
    """Tool call representation."""

    id: str
    function: Dict[str, str]  # {"name": str, "arguments": str}


class BaseServer(ABC, Generic[TRequest, TResponse]):
    """
    Abstract base class for all server implementations.

    THREAD SAFETY:
    - Python web servers (uvicorn, gunicorn) may use multiple worker processes/threads
    - Unlike Node.js (single-threaded event loop), we need explicit thread safety
    - Use locks to protect shared state
    """

    def __init__(self):
        """Initialize server."""
        self.app: Optional[FastAPI] = None
        self.server: Optional[uvicorn.Server] = None
        self.agent: Optional[BaseAgent] = None
        self._server_thread: Optional[threading.Thread] = None

        # Thread-safe state management
        self._state_lock = threading.Lock()
        self._is_running = False

    @abstractmethod
    async def handle_request(
        self, request: TRequest, response: Optional[Response] = None
    ) -> TResponse:
        """
        Handle a request and return a response.

        The specific format depends on the server implementation.
        This method is used for both in-process usage and HTTP routes.

        Args:
            request: The request to handle
            response: Optional FastAPI Response for streaming/HTTP output

        Returns:
            Response object (always returned, even when writing to response)
        """
        pass

    @abstractmethod
    def convert_request_to_prompt(self, request: TRequest) -> str:
        """
        Convert request to prompt string.
        Subclasses must implement this to handle their specific request format.
        """
        pass

    @abstractmethod
    def create_tool_call_response(
        self, request: TRequest, tool_calls: list[ToolCall]
    ) -> TResponse:
        """
        Create response for function/tool calls.
        Subclasses must implement this to format tool calls in their API format.
        """
        pass

    @abstractmethod
    def create_normal_response(self, request: TRequest, content: str) -> TResponse:
        """
        Create normal (non-function-call) response.
        Subclasses must implement this to format text content in their API format.
        """
        pass

    async def run_agent_core(
        self, agent_input: Any, config_overrides: Optional[AllAgentConfigs] = None
    ) -> str:
        """
        Run agent and collect output (shared logic).

        This method runs in the same process and doesn't need thread safety
        for agent execution itself (agent.run() handles its own state).
        """
        if not self.agent:
            raise RuntimeError(
                "Agent not set. Subclass must set self.agent in constructor."
            )

        messages: list[str] = []

        for event in self.agent.run(agent_input, config_overrides):
            if isinstance(event, MessageEvent):
                messages.append(event.content or "")

        return "\n\n".join(messages)

    def register_routes(self, app: FastAPI) -> None:
        """
        Register custom HTTP routes.

        Subclasses can override this to add their specific routes
        (e.g., /v1/chat/completions for OpenAI).
        """
        pass

    async def start_http_server(
        self, options: Optional[HttpServerOptions] = None
    ) -> None:
        """
        Start HTTP server with common routes.

        Common routes provided:
        - GET /health - Health check endpoint
        - GET /v1/models - List available models

        THREAD SAFETY: Uses lock to protect server state
        """
        if options is None:
            options = HttpServerOptions()

        with self._state_lock:
            if self._is_running:
                raise RuntimeError("Server is already running")
            self._is_running = True

        # Create FastAPI app
        self.app = FastAPI(title="AgentWrap Server", version="0.1.0")

        # Common routes
        @self.app.get("/health")
        async def health_check():
            return JSONResponse(
                {
                    "status": "ok",
                    "service": "agentwrap",
                    "version": "0.1.0",
                }
            )

        @self.app.get("/v1/models")
        async def list_models():
            import time

            return JSONResponse(
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "agentwrap-codex",
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "agentwrap",
                        }
                    ],
                }
            )

        # Let subclass register custom routes
        self.register_routes(self.app)

        # Configure uvicorn server
        config = uvicorn.Config(
            app=self.app,
            host=options.host,
            port=options.port,
            log_level="info",
        )
        self.server = uvicorn.Server(config)

        # Run server in background thread (for async compatibility)
        print(f"[BaseServer] HTTP server starting on {options.host}:{options.port}")

        # Start server (blocking call, should be run in asyncio.run or background thread)
        await self.server.serve()

    async def stop_http_server(self) -> None:
        """
        Stop HTTP server.

        THREAD SAFETY: Uses lock to protect server state
        """
        with self._state_lock:
            if not self._is_running:
                return

            if self.server:
                self.server.should_exit = True
                # Wait for server to shutdown
                await asyncio.sleep(0.1)

            self._is_running = False
            self.server = None
            self.app = None
            print("[BaseServer] HTTP server stopped")

    def get_app(self) -> Optional[FastAPI]:
        """Get the FastAPI app instance (for testing or advanced usage)."""
        return self.app
