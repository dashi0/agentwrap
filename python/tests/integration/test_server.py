"""
Integration tests for OpenAI compatible server.

Tests HTTP server functionality, streaming, and thread safety.
"""

import asyncio
import json
import time
from threading import Thread

import pytest
from httpx import AsyncClient

from agentwrap import CodexAgent, OpenAICompatibleServer
from agentwrap.config import AgentInput


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
async def test_server_creation(test_agent):
    """Test that server can be created with an agent."""
    server = OpenAICompatibleServer(test_agent)
    assert server is not None
    assert server.agent is test_agent


@pytest.mark.asyncio
async def test_server_health_endpoint(test_agent):
    """Test health check endpoint."""
    server = OpenAICompatibleServer(test_agent)

    # Start server in background task
    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8001, host="127.0.0.1")

    # Create task for server
    server_task = asyncio.create_task(server.start_http_server(options))

    # Wait for server to start
    await asyncio.sleep(1)

    try:
        # Make request to health endpoint
        async with AsyncClient(base_url="http://127.0.0.1:8001") as client:
            response = await client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["service"] == "agentwrap"

    finally:
        # Stop server
        await server.stop_http_server()
        # Cancel server task
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_server_models_endpoint(test_agent):
    """Test models list endpoint."""
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8002, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        async with AsyncClient(base_url="http://127.0.0.1:8002") as client:
            response = await client.get("/v1/models")
            assert response.status_code == 200
            data = response.json()
            assert data["object"] == "list"
            assert len(data["data"]) > 0
            assert data["data"][0]["id"] == "agentwrap-codex"

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_server_chat_completions_non_streaming(test_agent):
    """Test chat completions endpoint (non-streaming)."""
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8003, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        async with AsyncClient(
            base_url="http://127.0.0.1:8003", timeout=30.0
        ) as client:
            response = await client.post(
                "/v1/chat/completions",
                json={
                    "model": "agentwrap-codex",
                    "messages": [{"role": "user", "content": "What is 2+2? Just give the number."}],
                    "stream": False,
                },
            )
            assert response.status_code == 200
            data = response.json()
            assert "choices" in data
            assert len(data["choices"]) > 0
            assert "message" in data["choices"][0]
            # Should contain "4" in the response
            content = data["choices"][0]["message"]["content"]
            assert "4" in content

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_server_chat_completions_streaming(test_agent):
    """Test chat completions endpoint (streaming)."""
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8004, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        async with AsyncClient(
            base_url="http://127.0.0.1:8004", timeout=30.0
        ) as client:
            async with client.stream(
                "POST",
                "/v1/chat/completions",
                json={
                    "model": "agentwrap-codex",
                    "messages": [{"role": "user", "content": "Say hello in one word."}],
                    "stream": True,
                },
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers["content-type"]

                # Collect chunks
                chunks = []
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]  # Remove "data: " prefix
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            chunks.append(chunk)
                        except json.JSONDecodeError:
                            pass

                # Should have received multiple chunks
                assert len(chunks) > 0

                # First chunk should have role
                assert chunks[0]["choices"][0]["delta"].get("role") == "assistant"

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_thread_safety_concurrent_requests(test_agent):
    """
    Test thread safety with concurrent requests.

    This tests that multiple concurrent requests don't interfere with each other.
    Critical for Python since web servers may use multiple threads/processes.
    """
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.base_server import HttpServerOptions

    options = HttpServerOptions(port=8005, host="127.0.0.1")

    server_task = asyncio.create_task(server.start_http_server(options))
    await asyncio.sleep(1)

    try:
        # Make 5 concurrent requests
        async def make_request(number: int):
            async with AsyncClient(
                base_url="http://127.0.0.1:8005", timeout=30.0
            ) as client:
                response = await client.post(
                    "/v1/chat/completions",
                    json={
                        "model": "agentwrap-codex",
                        "messages": [
                            {"role": "user", "content": f"What is {number}+{number}? Just give the number."}
                        ],
                        "stream": False,
                    },
                )
                assert response.status_code == 200
                data = response.json()
                return data

        # Run 5 requests concurrently
        results = await asyncio.gather(
            make_request(1),
            make_request(2),
            make_request(3),
            make_request(4),
            make_request(5),
        )

        # All requests should complete successfully
        assert len(results) == 5
        for result in results:
            assert "choices" in result
            assert len(result["choices"]) > 0

    finally:
        await server.stop_http_server()
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_in_process_usage(test_agent):
    """Test using server in-process without HTTP."""
    server = OpenAICompatibleServer(test_agent)

    from agentwrap.server.types import ChatCompletionRequest

    # Create request
    request = ChatCompletionRequest(
        model="agentwrap-codex",
        messages=[{"role": "user", "content": "What is 3+3? Just give the number."}],
        stream=False,
    )

    # Handle request directly (no HTTP)
    response = await server.handle_request(request)

    # Verify response
    assert response.id is not None
    assert response.model == "agentwrap-codex"
    assert len(response.choices) > 0
    content = response.choices[0].message.content
    assert "6" in content
