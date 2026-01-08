# AgentWrap

Wrap agents, ship APIs - Turn agent CLIs into libraries and OpenAI-compatible servers

## Installation

```bash
pip install agentwrap
```

## Quick Start

```python
from agentwrap import CodexAgent, OpenAICompatibleServer

# Create and configure agent
agent = CodexAgent()
agent.configure({
    "agent_config": {"type": "codex-agent"},
    "skills": []
})

# Create OpenAI-compatible server
server = OpenAICompatibleServer(agent)

# Start HTTP server
await server.start_http_server({"port": 8000})
```

## Features

- 🤖 Wrap agent CLIs as Python libraries
- 🔌 OpenAI-compatible API server
- 🛠️ Function calling support
- 📦 MCP (Model Context Protocol) integration
- 🔄 Streaming responses

## Documentation

For full documentation, visit: https://github.com/dashi0/agentwrap

## License

MIT
