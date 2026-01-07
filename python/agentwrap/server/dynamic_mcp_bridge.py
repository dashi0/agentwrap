"""
Dynamic MCP Bridge for OpenAI Chat Completion Compatible API

Problem: How to enable codex-cli agent to call back user-defined functions?

Solution:
1. When OpenAI API request arrives with function definitions:
   - Create a dynamic MCP server listening on 127.0.0.1 (Streamable HTTP)
   - Convert user's function definitions into MCP tools
   - Inject this MCP server into codex-cli via -c flag

2. When codex-cli calls these dynamic MCP tools:
   - Mark "user-defined function called" in-process
   - Terminate codex-cli execution (with delay for multi-tool calls)
   - Return OpenAI function_call response format to user

3. On next turn (user provides function results):
   - Translate function call history into prompt context
   - Continue conversation with codex-cli

Implementation notes:
- Single global HTTP server (avoid multiple ports for concurrent requests)
- Each request gets unique ID, function names suffixed with requestId
- Multiple concurrent requests can coexist without conflict
- **THREAD SAFETY**: Uses locks to protect all shared state
"""

import asyncio
import json
import secrets
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import PlainTextResponse, StreamingResponse
import uvicorn

from .dynamic_mcp_server import DynamicMcpServer, ToolCallRecord


@dataclass
class RequestContext:
    """
    Context for each OpenAI chat completion request.
    Tracks function definitions and their MCP server instance.
    """

    request_id: str
    mcp_server: DynamicMcpServer
    original_functions: List[Dict[str, Any]]
    function_name_map: Dict[str, str]  # suffixed -> original


class DynamicMcpBridge:
    """
    Manages dynamic MCP servers for user-defined functions in OpenAI API requests.

    This singleton handles the lifecycle of temporary MCP servers that bridge
    user-defined functions with codex-cli agent.

    THREAD SAFETY:
    - All methods that access shared state use locks
    - Multiple threads can safely register/unregister requests concurrently
    - HTTP server start/stop is protected by lock
    - requests map is protected by lock
    """

    _instance: Optional["DynamicMcpBridge"] = None
    _instance_lock = threading.Lock()

    def __new__(cls):
        """Singleton pattern with thread-safe instantiation."""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        """Initialize bridge (only called once due to singleton)."""
        if hasattr(self, "_initialized"):
            return

        self._initialized = True

        # HTTP server state (protected by lock)
        self._server_lock = threading.Lock()
        self.http_server: Optional[uvicorn.Server] = None
        self.server_port: Optional[int] = None
        self.server_host: str = "127.0.0.1"
        self._server_task: Optional[asyncio.Task] = None

        # Request contexts (protected by lock)
        self._requests_lock = threading.Lock()
        self.requests: Dict[str, RequestContext] = {}

        # FastAPI app
        self.app: Optional[FastAPI] = None

    async def ensure_server_started(
        self, host: str = "127.0.0.1", port: int = 0
    ) -> int:
        """
        Get or create the global HTTP server for dynamic MCP bridge.

        THREAD SAFETY: Uses lock to protect server state.

        Args:
            host: Server host
            port: Server port (0 = random port)

        Returns:
            Actual port number
        """
        import socket
        import time

        with self._server_lock:
            # Server already running
            if self.http_server and self.server_port is not None:
                return self.server_port

            # If port is 0, find an available port
            if port == 0:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind((host, 0))
                    s.listen(1)
                    port = s.getsockname()[1]

            self.server_port = port
            self.server_host = host

            # Create FastAPI app
            self.app = FastAPI(title="Dynamic MCP Bridge")

            # Register routes
            @self.app.get("/.well-known/oauth-authorization-server")
            async def oauth_discovery():
                return {}

            @self.app.options("/")
            async def cors_preflight():
                return Response(
                    status_code=200,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type",
                    },
                )

            @self.app.post("/")
            async def handle_mcp_request(request: Request):
                return await self._handle_http_request(request)

            # Configure uvicorn
            config = uvicorn.Config(
                app=self.app,
                host=host,
                port=port,
                log_level="warning",
            )
            self.http_server = uvicorn.Server(config)

            # Start server in background thread
            def run_server():
                asyncio.run(self.http_server.serve())

            server_thread = threading.Thread(target=run_server, daemon=True)
            server_thread.start()

            # Wait for server to be ready
            max_wait = 5
            start_time = time.time()
            while time.time() - start_time < max_wait:
                try:
                    # Try to connect to the server to verify it's ready
                    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                        s.settimeout(0.1)
                        s.connect((host, port))
                        break
                except (socket.error, ConnectionRefusedError):
                    time.sleep(0.1)
            else:
                raise RuntimeError("Server failed to start")

            print(
                f"[DynamicMcpBridge] HTTP server started on {self.server_host}:{self.server_port}"
            )

            return self.server_port

    def register_request(self, functions: List[Dict[str, Any]]) -> RequestContext:
        """
        Register a new OpenAI request with user-defined functions.
        Creates a dynamic MCP server instance for this request.

        THREAD SAFETY: Uses lock to protect requests map.

        Args:
            functions: List of function definitions

        Returns:
            RequestContext for this request
        """
        request_id = secrets.token_hex(6)

        # Add suffix to function names to avoid conflicts between concurrent requests
        function_name_map: Dict[str, str] = {}
        suffixed_functions = []

        for fn in functions:
            suffixed_name = f"{fn['name']}_{request_id}"
            function_name_map[suffixed_name] = fn["name"]

            suffixed_fn = {**fn, "name": suffixed_name}
            suffixed_functions.append(suffixed_fn)

        # Create dynamic MCP server for these user-defined functions
        mcp_server = DynamicMcpServer(suffixed_functions)

        context = RequestContext(
            request_id=request_id,
            mcp_server=mcp_server,
            original_functions=functions,
            function_name_map=function_name_map,
        )

        # Store context (thread-safe)
        with self._requests_lock:
            self.requests[request_id] = context

        print(
            f"[DynamicMcpBridge] Registered request {request_id} with user functions: "
            f"{[f['name'] for f in functions]}"
        )

        return context

    def unregister_request(self, request_id: str) -> None:
        """
        Unregister a request and cleanup its dynamic MCP server.

        THREAD SAFETY: Uses lock to protect requests map.

        Args:
            request_id: Request ID to unregister
        """
        with self._requests_lock:
            context = self.requests.get(request_id)
            if context:
                context.mcp_server.cancel_termination()
                del self.requests[request_id]
                print(f"[DynamicMcpBridge] Unregistered request {request_id}")

    async def _handle_http_request(self, request: Request) -> Response:
        """
        Handle incoming HTTP request.

        THREAD SAFETY: Accesses requests map with lock.
        """
        try:
            body = await request.body()
            mcp_request = json.loads(body.decode("utf-8"))

            print(f"[DynamicMcpBridge] MCP request: {json.dumps(mcp_request)}")

            method = mcp_request.get("method", "")

            # Check if notification
            is_notification = method.startswith("notifications/")

            if is_notification:
                # Return HTTP 202 Accepted for notifications
                print(f"[DynamicMcpBridge] Notification: {method}")
                return Response(
                    status_code=202,
                    headers={
                        "Content-Length": "0",
                        "Access-Control-Allow-Origin": "*",
                    },
                )

            # Handle requests
            if method == "initialize":
                return await self._handle_initialize(mcp_request)
            elif method == "tools/list":
                return await self._handle_tools_list(mcp_request)
            elif method == "tools/call":
                return await self._handle_tools_call(mcp_request)
            else:
                # Unknown method
                return StreamingResponse(
                    self._sse_response(
                        {
                            "jsonrpc": "2.0",
                            "id": mcp_request.get("id"),
                            "error": {
                                "code": -32601,
                                "message": f"Method not found: {method}",
                            },
                        }
                    ),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Access-Control-Allow-Origin": "*",
                    },
                )

        except Exception as error:
            print(f"[DynamicMcpBridge] Error: {error}")
            return PlainTextResponse(
                "Internal Server Error", status_code=500
            )

    async def _handle_initialize(self, mcp_request: Dict[str, Any]) -> Response:
        """Handle initialize request."""
        response = {
            "jsonrpc": "2.0",
            "id": mcp_request.get("id"),
            "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "userDefinedFunctions", "version": "1.0.0"},
            },
        }

        return StreamingResponse(
            self._sse_response(response),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            },
        )

    async def _handle_tools_list(self, mcp_request: Dict[str, Any]) -> Response:
        """
        Handle tools/list by aggregating all user-defined functions from all active requests.

        THREAD SAFETY: Accesses requests map with lock.
        """
        all_tools = []

        # Aggregate tools from all concurrent requests
        with self._requests_lock:
            for context in self.requests.values():
                mcp_response = context.mcp_server.handle_request(mcp_request)
                if mcp_response and mcp_response.get("result"):
                    result_tools = mcp_response["result"].get("tools", [])
                    all_tools.extend(result_tools)

        response = {
            "jsonrpc": "2.0",
            "id": mcp_request.get("id"),
            "result": {"tools": all_tools},
        }

        return StreamingResponse(
            self._sse_response(response),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            },
        )

    async def _handle_tools_call(self, mcp_request: Dict[str, Any]) -> Response:
        """
        Handle tools/call by routing to the correct server.

        THREAD SAFETY: Accesses requests map with lock.
        """
        function_name = mcp_request.get("params", {}).get("name")

        if not function_name:
            return PlainTextResponse("Missing function name", status_code=400)

        # Find the request context that has this function
        with self._requests_lock:
            for context in self.requests.values():
                if function_name in context.function_name_map:
                    # Handle the tool call with this context's server
                    mcp_response = context.mcp_server.handle_request(mcp_request)

                    if mcp_response:
                        return StreamingResponse(
                            self._sse_response(mcp_response),
                            media_type="text/event-stream",
                            headers={
                                "Cache-Control": "no-cache",
                                "Access-Control-Allow-Origin": "*",
                            },
                        )

        # Function not found
        response = {
            "jsonrpc": "2.0",
            "id": mcp_request.get("id"),
            "error": {"code": -32601, "message": f"Tool not found: {function_name}"},
        }

        return StreamingResponse(
            self._sse_response(response),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            },
        )

    async def _sse_response(self, data: Dict[str, Any]):
        """Generate SSE response."""
        yield f"data: {json.dumps(data)}\n\n"

    def get_port(self) -> Optional[int]:
        """Get the current server port (None if not started)."""
        with self._server_lock:
            return self.server_port

    def get_host(self) -> str:
        """Get the server host."""
        return self.server_host

    def remove_function_suffix(self, suffixed_name: str) -> str:
        """
        Remove suffix from function name to get original name.

        THREAD SAFETY: Accesses requests map with lock.
        """
        with self._requests_lock:
            for context in self.requests.values():
                original_name = context.function_name_map.get(suffixed_name)
                if original_name:
                    return original_name

        # If not found, return as-is
        return suffixed_name

    def get_context_by_function_name(
        self, function_name: str
    ) -> Optional[RequestContext]:
        """
        Get request context by function name.

        THREAD SAFETY: Accesses requests map with lock.
        """
        with self._requests_lock:
            for context in self.requests.values():
                if function_name in context.function_name_map:
                    return context
        return None


# Export singleton instance
dynamic_mcp_bridge = DynamicMcpBridge()
