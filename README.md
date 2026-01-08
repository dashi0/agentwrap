# 📦 AgentWrap

> **Wrap agents, ship APIs**

AgentWrap turns agent CLIs into callable libraries and OpenAI-compatible API servers, enabling agent-centric, markdown/skills driven app development with ease.

[![npm version](https://img.shields.io/npm/v/agentwrap.svg)](https://www.npmjs.com/package/agentwrap)
[![PyPI version](https://img.shields.io/pypi/v/agentwrap.svg)](https://pypi.org/project/agentwrap/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 💡 What is AgentWrap?

AgentWrap is a **simple wrapper framework** that wraps powerful agent CLIs (like Codex) into clean, reusable interfaces, so you can use them as libraries or APIs without rebuilding agent logic from scratch.

**Key Features:**
- 📚 **Python/TypeScript libraries** - Call agents as simple functions in your code
- 🌐 **OpenAI-compatible API server** - Drop-in replacement for OpenAI API with agent backends
- 🧠 **Advanced reasoning** - Leverage modern agent capabilities (Codex, etc.)
- 📝 **Markdown-based skills & rich ecosystem** - Simple, declarative skill system
- 🔒 **Built-in safety** - Sandboxing and permission controls

---

## 🆚 How is this different from LangChain/PromptFlow?

| Feature | LangChain/PromptFlow | **AgentWrap** |
|---------|---------------------|------------------|
| **Approach** | Build agent logic in Python/JS | **Wrap existing agent CLIs** |
| **Reasoning** | You implement chains/flows | **Leverage modern agent reasoning** (Codex, etc.) |
| **Complexity** | Heavy framework, many abstractions | **Thin wrapper, minimal code** |
| **Skills/Tools** | Define tools via code | **Use markdown-based skills** (Codex native) |

---

## 🚀 Quick Start

### TypeScript

```bash
npm install agentwrap
```

```typescript
import { CodexAgent } from 'agentwrap';

const agent = new CodexAgent();
await agent.configure({
  agent_config: { type: 'codex-agent', apiKey: '' },
  skills: [
    {type: 'anthropic-skill', path: './skills/random'}
  ]
});

// Use as library
for await (const event of agent.run('Generate a random number for me')) {
  console.log(JSON.stringify(event.content));
}

// Or start as OpenAI-compatible API server
import { OpenAICompatibleServer } from 'agentwrap';
const server = new OpenAICompatibleServer(agent);
await server.startHttpServer({ port: 8000 });
```

[More examples](./typescript/examples.ts).

### Python

```bash
pip install agentwrap
```

```python
from agentwrap import CodexAgent, OpenAICompatibleServer

# Create and configure agent
agent = CodexAgent()
agent.configure({
    "agent_config": {"type": "codex-agent"},
    "skills": []
})

# Use as library
for event in agent.run("Generate a random number for me"):
    print(event.content)

# Or start as OpenAI-compatible API server
server = OpenAICompatibleServer(agent)
await server.start_http_server({"port": 8000})
```

[More examples](./python/README.md).

---

## 🎓 Key Concepts

### Agent-Centric Development

AgentWrap promotes **agent-centric** development:
- Let the **agent decide** how to solve problems (don't micromanage with chains)
- Use **markdown skills** to extend capabilities (declarative, simple)
- Trust modern agent **reasoning** (Claude Codex, etc.)

### Markdown/Skills Driven

Instead of writing Python/JS tool definitions:

```python
# LangChain style (you write the logic)
@tool
def get_weather(location: str) -> str:
    # You implement everything
    return call_weather_api(location)
```

Use **markdown skills** (agent handles it):

```markdown
# Weather Skill (SKILL.md)

Get weather information for a location.

## Usage
When user asks about weather, use this skill.

## Implementation
Call the weather API: https://api.weather.com/...
```

The agent reads the markdown, understands intent, and **reasons about when/how to use it**.

---


## 🌍 Multi-Language Support

AgentWrap provides SDKs in multiple languages with consistent APIs:

| Language | Status | Package | Documentation |
|----------|--------|---------|---------------|
| 🐍 **Python** | ✅ Published | [`pip install agentwrap`](https://pypi.org/project/agentwrap/) | [Python Docs](./python/README.md) |
| 📘 **TypeScript** | ✅ Published | [`npm install agentwrap`](https://www.npmjs.com/package/agentwrap) | [TypeScript Docs](./typescript/README.md) |

---

## 🤝 Contributing

We welcome contributions! Please read [AGENTS.md](./AGENTS.md) for development guidelines.

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details
