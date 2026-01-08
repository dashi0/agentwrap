# AgentWrap

Wrap agents, ship APIs - Turn agent CLIs into libraries and OpenAI-compatible servers

## Prerequisites

CodexAgent requires the OpenAI Codex CLI to be installed:

```bash
npm install -g @openai/codex
```

**Note**: Unlike the TypeScript package which bundles Codex as a dependency, Python cannot auto-install Node.js CLI tools. You must install Codex globally.

📚 **Detailed installation guide**: See [docs/codex-installation-guide.md](https://github.com/dashi0/agentwrap/blob/master/docs/codex-installation-guide.md) for platform-specific instructions, Docker setup, and troubleshooting.

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
    "agent_config": {"type": "codex-agent", "api_key": "OPENA_API_KEY"},
    "skills": [
      {"type": "anthropic-skill", "path": "./skills/random"}
    ]
})

# Use as library
for event in agent.run("Generate a random number for me"):
    print(event)

# Or start as OpenAI-compatible API server
server = OpenAICompatibleServer(agent)
await server.start_http_server({"port": 8000})
```
[More examples](./agentwrap/examples.py).

## Features

- 🤖 Wrap agent CLIs as Python libraries
- 🔌 OpenAI-compatible API server
- 🛠️ Function calling support
- 📦 MCP (Model Context Protocol) integration
- 🔄 Streaming responses

## Documentation

For full documentation, visit: https://github.com/dashi0/agentwrap

## Changelog

See [CHANGELOG.md](https://github.com/dashi0/agentwrap/blob/master/docs/CHANGELOG.md) for release history and version updates.

## License

MIT
