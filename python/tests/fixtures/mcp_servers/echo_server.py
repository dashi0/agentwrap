#!/usr/bin/env python3
"""
Simple MCP server for testing.

Provides an echo tool that returns whatever is sent to it.
"""

import json
import sys


def send_message(message):
    """Send a JSON-RPC message to stdout."""
    print(json.dumps(message), flush=True)


def handle_initialize(request):
    """Handle initialize request."""
    send_message({
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "echo-server",
                "version": "1.0.0"
            }
        }
    })


def handle_tools_list(request):
    """Handle tools/list request."""
    send_message({
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "result": {
            "tools": [
                {
                    "name": "echo",
                    "description": "Echoes back the input message",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "message": {
                                "type": "string",
                                "description": "Message to echo back"
                            }
                        },
                        "required": ["message"]
                    }
                },
                {
                    "name": "reverse",
                    "description": "Reverses the input string",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text to reverse"
                            }
                        },
                        "required": ["text"]
                    }
                }
            ]
        }
    })


def handle_tools_call(request):
    """Handle tools/call request."""
    params = request.get("params", {})
    tool_name = params.get("name")
    arguments = params.get("arguments", {})

    if tool_name == "echo":
        message = arguments.get("message", "")
        result = {
            "content": [
                {
                    "type": "text",
                    "text": f"Echo: {message}"
                }
            ]
        }
    elif tool_name == "reverse":
        text = arguments.get("text", "")
        reversed_text = text[::-1]
        result = {
            "content": [
                {
                    "type": "text",
                    "text": reversed_text
                }
            ]
        }
    else:
        send_message({
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "error": {
                "code": -32601,
                "message": f"Unknown tool: {tool_name}"
            }
        })
        return

    send_message({
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "result": result
    })


def main():
    """Main server loop."""
    # Read line-by-line from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            method = request.get("method")

            if method == "initialize":
                handle_initialize(request)
            elif method == "tools/list":
                handle_tools_list(request)
            elif method == "tools/call":
                handle_tools_call(request)
            else:
                # Unknown method
                send_message({
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                })
        except json.JSONDecodeError:
            send_message({
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32700,
                    "message": "Parse error"
                }
            })
        except Exception as e:
            send_message({
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}"
                }
            })


if __name__ == "__main__":
    main()
