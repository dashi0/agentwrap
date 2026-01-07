"""
AgentWrap Python Examples

This file demonstrates how to use AgentWrap to wrap agent CLIs
into callable libraries and OpenAI-compatible API servers.
"""

import asyncio
import json
from agentwrap import CodexAgent, AgentInput, OpenAICompatibleServer
from agentwrap.base_server import HttpServerOptions


# ============================================================================
# Example 1: Basic Usage with agent.run()
# ============================================================================

def example1_basic_run():
    """Basic usage: Configure agent and run a simple query."""
    print("\n=== Example 1: Basic agent.run() ===\n")

    # Create agent
    agent = CodexAgent()

    # Optional: Configure with API key and skills
    agent.configure({
        "agent_config": {
            "type": "codex-agent",
            # "api_key": "your-api-key",  # Optional, defaults to env:OPENAI_API_KEY
        },
        "skills": [
            # Anthropic Skill (markdown-based)
            {
                "type": "anthropic-skill",
                "path": "./tests/fixtures/skills/echo_skill",
            },
        ],
    })

    print('Query: Use the echo skill to repeat "Hello from AgentWrap!"\n')
    print("Response:")

    # Notice: passing string directly (no need for AgentInput.from_query())
    for event in agent.run('Use the echo skill to repeat this message: "Hello from AgentWrap!"'):
        print(json.dumps({"type": event.type.value if hasattr(event, "type") else None, "content": getattr(event, "content", None)}))

    print("\n")


# ============================================================================
# Example 2: Structured Output & Conversation
# ============================================================================

def example2_structured_and_conversation():
    """Structured output and conversation with message history."""
    print("\n=== Example 2: Structured Output & Conversation ===\n")

    agent = CodexAgent()

    agent.configure({
        "agent_config": {
            "type": "codex-agent",
            # "api_key": "your-api-key",  # Optional, defaults to env:OPENAI_API_KEY
        },
        "skills": [
            # MCP Server (stdio transport)
            {
                "type": "mcp",
                "transport": "stdio",
                "command": "node",
                "args": ["./tests/fixtures/mcp_servers/echo_server.cjs"],
            },
        ],
    })

    schema = {
        "type": "object",
        "properties": {
            "country": {"type": "string"},
            "capital": {"type": "string"},
            "population": {"type": "number"},
            "funFact": {"type": "string"},
        },
        "required": ["country", "capital", "population", "funFact"],
    }

    messages = [
        {"role": "user", "content": "What is the capital of Japan?"},
        {"role": "assistant", "content": "Tokyo"},
        {"role": "user", "content": "Respond to me via JSON about Japan: its capital, approximate population, and a fun fact."},
    ]

    conversation_input = AgentInput.from_messages(messages)

    for msg in messages:
        role_display = "User" if msg["role"] == "user" else "Assistant"
        print(f"{role_display}: {msg['content']}")
    print("Assistant: ")

    result = agent.run_structured(conversation_input, schema)

    print("Result:")
    print(json.dumps(result, indent=2))

    print("\n")


# ============================================================================
# Example 3: HTTP Server with OpenAI-Compatible API
# ============================================================================

async def example3_http_server():
    """Start an OpenAI-compatible HTTP server."""
    print("\n=== Example 3: HTTP Server ===\n")

    # 1. Create and configure the agent
    agent = CodexAgent()
    agent.configure({
        "agent_config": {
            "type": "codex-agent",
            # "api_key": "your-api-key",  # Optional, defaults to env:OPENAI_API_KEY
        },
        "skills": [
            # Anthropic Skill
            {
                "type": "anthropic-skill",
                "path": "./tests/fixtures/skills/echo_skill",
            },
        ],
    })

    # 2. Create the OpenAI-compatible server
    server = OpenAICompatibleServer(agent)

    # 3. Start HTTP server
    port = 3000
    options = HttpServerOptions(port=port, host="127.0.0.1")
    await server.start_http_server(options)

    print(f"""✅ OpenAI-compatible server started!

Available endpoints:
- GET  http://localhost:{port}/health              - Health check
- POST http://localhost:{port}/v1/chat/completions - Chat completion

Try with curl:
  curl http://localhost:{port}/health

  curl http://localhost:{port}/v1/models

  curl -X POST http://localhost:{port}/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{{
      "model": "agentwrap-codex",
      "messages": [
        {{"role": "user", "content": "Call echo skill to repeat \\"Hello from AgentWrap!\\""}}
      ],
      "stream": true
    }}'

Press Ctrl+C to stop the server.
""")

    # Keep process alive
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        print("\n⏹️  Stopping server...")
        await server.stop_http_server()


# ============================================================================
# Main: Run Examples
# ============================================================================

async def main():
    """Run all examples."""
    examples = [
        {"name": "basic", "fn": example1_basic_run},
        {"name": "structured", "fn": example2_structured_and_conversation},
        {"name": "server", "fn": example3_http_server},
    ]

    for example in examples:
        try:
            if asyncio.iscoroutinefunction(example["fn"]):
                await example["fn"]()
            else:
                example["fn"]()
        except Exception as err:
            print(f'Error in example "{example["name"]}":', err)
            import traceback
            traceback.print_exc()


# Run if executed directly
if __name__ == "__main__":
    asyncio.run(main())
