"""
Dynamic MCP Server

This module creates an MCP server that dynamically exposes user-provided
function definitions as MCP tools. When a tool is called, it records the
call and signals the agent to stop.
"""

import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

from .types import ChatCompletionFunction


@dataclass
class MCPRequest:
    """MCP JSON-RPC request."""

    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None
    method: str = ""
    params: Optional[Dict[str, Any]] = None


@dataclass
class MCPResponse:
    """MCP JSON-RPC response."""

    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None


@dataclass
class MCPTool:
    """MCP tool definition."""

    name: str
    description: str
    input_schema: Dict[str, Any]


@dataclass
class ToolCallRecord:
    """Record of a tool call."""

    id: str
    function: Dict[str, str]  # {"name": str, "arguments": str (JSON)}


class DynamicMcpServer:
    """
    Dynamic MCP Server that proxies user-defined functions.

    THREAD SAFETY:
    - Uses locks to protect tool_calls list
    - Uses threading.Event for termination signaling
    - Safe for concurrent access from multiple threads
    """

    def __init__(
        self,
        functions: List[Dict[str, Any]],
        termination_delay_ms: int = 2000,
    ):
        """
        Initialize dynamic MCP server.

        Args:
            functions: List of function definitions
            termination_delay_ms: Delay before terminating agent (to collect multiple tool calls)
        """
        self.functions = functions
        self.termination_delay_ms = termination_delay_ms

        # Thread-safe state
        self._tool_calls_lock = threading.Lock()
        self.tool_calls: List[ToolCallRecord] = []
        self.next_tool_call_id = 0

        # Termination signaling
        self.termination_event = threading.Event()
        self.termination_timer: Optional[threading.Timer] = None

        # Event callbacks
        self._on_tool_call: Optional[Callable[[ToolCallRecord], None]] = None
        self._on_terminate: Optional[Callable[[List[ToolCallRecord]], None]] = None

    def get_tools(self) -> List[MCPTool]:
        """Get the tools list in MCP format."""
        tools = []
        for fn in self.functions:
            # Convert function def to MCP tool
            tool = MCPTool(
                name=fn["name"],
                description=fn.get("description", f"User-defined function: {fn['name']}"),
                input_schema={
                    "type": "object",
                    "properties": fn.get("parameters", {}).get("properties", {}),
                    "required": fn.get("parameters", {}).get("required", []),
                },
            )
            tools.append(tool)
        return tools

    def handle_request(self, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Handle MCP request.

        THREAD SAFETY: This method is thread-safe.
        """
        method = request.get("method", "")
        req_id = request.get("id")
        params = request.get("params", {})

        print(f"[DynamicMcpServer] Received request: method={method}, id={req_id}")

        try:
            if method == "initialize":
                return self._handle_initialize(req_id)
            elif method == "notifications/initialized":
                # Notification - no response needed
                print("[DynamicMcpServer] Initialized notification received")
                return None
            elif method == "tools/list":
                return self._handle_tools_list(req_id)
            elif method == "tools/call":
                print(f"[DynamicMcpServer] Tool call: {params}")
                return self._handle_tools_call(req_id, params)
            else:
                print(f"[DynamicMcpServer] Unknown method: {method}")
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}",
                    },
                }
        except Exception as error:
            print(f"[DynamicMcpServer] Error: {error}")
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(error)}",
                },
            }

    def _handle_initialize(self, req_id: Optional[Union[str, int]]) -> Dict[str, Any]:
        """Handle initialize request."""
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "agentwrap-dynamic-mcp",
                    "version": "1.0.0",
                },
            },
        }

    def _handle_tools_list(self, req_id: Optional[Union[str, int]]) -> Dict[str, Any]:
        """Handle tools/list request."""
        tools = self.get_tools()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.input_schema,
                    }
                    for tool in tools
                ],
            },
        }

    def _handle_tools_call(
        self, req_id: Optional[Union[str, int]], params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle tools/call request.

        This records the function call and schedules agent termination.

        THREAD SAFETY: Uses lock to protect tool_calls list.
        """
        name = params.get("name", "")
        args = params.get("arguments", {})
        args_string = json.dumps(args)

        # Check if this exact tool call already exists (deduplicate)
        with self._tool_calls_lock:
            is_duplicate = any(
                tc.function["name"] == name and tc.function["arguments"] == args_string
                for tc in self.tool_calls
            )

            if not is_duplicate:
                # Generate unique tool call ID
                tool_call_id = f"call_{int(time.time() * 1000)}_{self.next_tool_call_id}"
                self.next_tool_call_id += 1

                # Record the tool call
                tool_call = ToolCallRecord(
                    id=tool_call_id,
                    function={
                        "name": name,
                        "arguments": args_string,
                    },
                )

                self.tool_calls.append(tool_call)

                # Call event callback if set
                if self._on_tool_call:
                    self._on_tool_call(tool_call)

                # Schedule agent termination (delayed to allow multiple tool calls)
                self._schedule_termination()
            else:
                print(f"[DynamicMcpServer] Skipping duplicate tool call: {name} with args {args_string}")

        # Return success response
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"[AgentWrap] Function {name} will be executed by user process. Waiting for response...",
                    }
                ],
            },
        }

    def _schedule_termination(self) -> None:
        """
        Schedule agent termination.

        Delays termination to allow multiple tool calls to be collected.

        THREAD SAFETY: Uses threading.Timer which is thread-safe.
        """
        # Cancel existing timer
        if self.termination_timer:
            self.termination_timer.cancel()

        # Schedule new timer
        def terminate():
            with self._tool_calls_lock:
                tool_calls_copy = list(self.tool_calls)
            self.termination_event.set()
            if self._on_terminate:
                self._on_terminate(tool_calls_copy)

        self.termination_timer = threading.Timer(
            self.termination_delay_ms / 1000.0, terminate
        )
        self.termination_timer.start()

    def get_tool_calls(self) -> List[ToolCallRecord]:
        """
        Get recorded tool calls.

        THREAD SAFETY: Returns a copy to avoid race conditions.
        """
        with self._tool_calls_lock:
            return list(self.tool_calls)

    def clear_tool_calls(self) -> None:
        """
        Clear recorded tool calls.

        THREAD SAFETY: Uses lock to protect state.
        """
        with self._tool_calls_lock:
            self.tool_calls = []
            self.next_tool_call_id = 0

    def cancel_termination(self) -> None:
        """
        Cancel termination timeout.

        THREAD SAFETY: Timer.cancel() is thread-safe.
        """
        if self.termination_timer:
            self.termination_timer.cancel()
            self.termination_timer = None

    def on_tool_call(self, callback: Callable[[ToolCallRecord], None]) -> None:
        """Set callback for tool call events."""
        self._on_tool_call = callback

    def on_terminate(self, callback: Callable[[List[ToolCallRecord]], None]) -> None:
        """Set callback for termination events."""
        self._on_terminate = callback
