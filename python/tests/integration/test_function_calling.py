"""
Integration tests for function calling with Dynamic MCP Bridge.

Tests the ability of the agent to call user-defined functions.
"""

import asyncio
import json

import pytest
from httpx import AsyncClient

from agentwrap import CodexAgent, OpenAICompatibleServer
from agentwrap.server.dynamic_mcp_bridge import dynamic_mcp_bridge


# Mark all tests in this module as integration tests
pytestmark = [pytest.mark.integration, pytest.mark.slow]


@pytest.fixture
def test_agent():
    """Create a configured test agent."""
    agent = CodexAgent()
    agent.configure(
        {
            "agent_config": {
                "type": "codex-agent",
            },
            "skills": [],
        },
        verbose=False,
    )
    return agent


@pytest.mark.asyncio
async def test_function_calling_basic(test_agent):
    """Test basic function calling."""
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8010, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        async with AsyncClient(
            base_url="http://127.0.0.1:8010", timeout=60.0
        ) as client:
            # Define a function
            functions = [
                {
                    "name": "get_weather",
                    "description": "Get the weather for a location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city name",
                            },
                            "unit": {
                                "type": "string",
                                "enum": ["celsius", "fahrenheit"],
                                "description": "Temperature unit",
                            },
                        },
                        "required": ["location"],
                    },
                }
            ]

            # Make request with function
            response = await client.post(
                "/v1/chat/completions",
                json={
                    "model": "agentwrap-codex",
                    "messages": [
                        {
                            "role": "user",
                            "content": "What's the weather in San Francisco?",
                        }
                    ],
                    "functions": functions,
                    "stream": False,
                },
            )

            assert response.status_code == 200
            data = response.json()

            # Check if function was called
            assert "choices" in data
            assert len(data["choices"]) > 0
            choice = data["choices"][0]

            # Should either call function or return normal response
            if choice.get("finish_reason") == "tool_calls":
                # Function was called
                message = choice["message"]
                assert "tool_calls" in message
                assert len(message["tool_calls"]) > 0

                tool_call = message["tool_calls"][0]
                assert tool_call["function"]["name"] == "get_weather"

                # Parse arguments
                args = json.loads(tool_call["function"]["arguments"])
                assert "location" in args
                assert "san francisco" in args["location"].lower()

                print(f"✅ Function called: {tool_call['function']['name']}")
                print(f"   Arguments: {args}")
            else:
                # Normal response
                print(f"ℹ️  Normal response: {choice['message']['content']}")

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_concurrent_function_calling(test_agent):
    """
    Test concurrent function calling requests.

    This tests thread safety - multiple requests with different functions
    should not interfere with each other.
    """
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8011, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        async def make_request_with_function(func_name: str, location: str):
            """Make a request with a specific function."""
            async with AsyncClient(
                base_url="http://127.0.0.1:8011", timeout=60.0
            ) as client:
                functions = [
                    {
                        "name": func_name,
                        "description": f"Get {func_name} for a location",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "location": {
                                    "type": "string",
                                    "description": "The city name",
                                },
                            },
                            "required": ["location"],
                        },
                    }
                ]

                response = await client.post(
                    "/v1/chat/completions",
                    json={
                        "model": "agentwrap-codex",
                        "messages": [
                            {
                                "role": "user",
                                "content": f"What's the {func_name} in {location}?",
                            }
                        ],
                        "functions": functions,
                        "stream": False,
                    },
                )

                assert response.status_code == 200
                return response.json()

        # Make 3 concurrent requests with different functions
        results = await asyncio.gather(
            make_request_with_function("get_weather", "Tokyo"),
            make_request_with_function("get_temperature", "London"),
            make_request_with_function("get_forecast", "Paris"),
        )

        # All requests should succeed
        assert len(results) == 3
        for result in results:
            assert "choices" in result
            assert len(result["choices"]) > 0

        print(f"✅ All {len(results)} concurrent requests completed successfully")

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_dynamic_mcp_bridge_singleton():
    """Test that dynamic MCP bridge is a singleton."""
    from agentwrap.server.dynamic_mcp_bridge import DynamicMcpBridge

    # Create multiple instances - should all be the same
    bridge1 = DynamicMcpBridge()
    bridge2 = DynamicMcpBridge()
    bridge3 = dynamic_mcp_bridge

    assert bridge1 is bridge2
    assert bridge2 is bridge3
    assert id(bridge1) == id(bridge2) == id(bridge3)

    print("✅ Dynamic MCP Bridge is a proper singleton")


@pytest.mark.asyncio
async def test_function_name_suffixing():
    """Test that function names are properly suffixed to avoid conflicts."""
    # Register two requests with same function name
    functions = [
        {
            "name": "test_function",
            "description": "Test function",
            "parameters": {
                "type": "object",
                "properties": {"arg": {"type": "string"}},
            },
        }
    ]

    context1 = dynamic_mcp_bridge.register_request(functions)
    context2 = dynamic_mcp_bridge.register_request(functions)

    try:
        # Different request IDs
        assert context1.request_id != context2.request_id

        # Function names should be suffixed
        assert len(context1.function_name_map) == 1
        assert len(context2.function_name_map) == 1

        # Get the suffixed names
        suffixed1 = list(context1.function_name_map.keys())[0]
        suffixed2 = list(context2.function_name_map.keys())[0]

        # Should be different
        assert suffixed1 != suffixed2
        assert suffixed1.startswith("test_function_")
        assert suffixed2.startswith("test_function_")

        # Both should map to original name
        assert context1.function_name_map[suffixed1] == "test_function"
        assert context2.function_name_map[suffixed2] == "test_function"

        print(f"✅ Function names properly suffixed:")
        print(f"   Request 1: test_function -> {suffixed1}")
        print(f"   Request 2: test_function -> {suffixed2}")

    finally:
        dynamic_mcp_bridge.unregister_request(context1.request_id)
        dynamic_mcp_bridge.unregister_request(context2.request_id)
