# AgentWrap (TypeScript)

Wrap agents, ship APIs - Turn agent CLIs into libraries and OpenAI-compatible servers

[![npm version](https://img.shields.io/npm/v/agentwrap.svg)](https://www.npmjs.com/package/agentwrap)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)

## Installation

```bash
npm install agentwrap
```

**Note**: TypeScript package bundles `@openai/codex` as a dependency - no additional setup required!

## Quick Start

```typescript
import { CodexAgent, OpenAICompatibleServer } from 'agentwrap';

const agent = new CodexAgent();
await agent.configure({
  agent_config: { type: 'codex-agent', apiKey: 'OPENAI_API_KEY' },
  skills: [
    {type: 'anthropic-skill', path: './skills/random'}
  ]
});

// Use as library
for await (const event of agent.run('Generate a random number for me')) {
  console.log(JSON.stringify(event.content));
}

// Or start as OpenAI-compatible API server
const server = new OpenAICompatibleServer(agent);
await server.startHttpServer({ port: 8000 });
```

[More examples](./examples.ts).

## Features

- 🤖 Wrap agent CLIs as TypeScript libraries
- 🔌 OpenAI-compatible API server
- 🛠️ Function calling support
- 📦 MCP (Model Context Protocol) integration
- 🔄 Streaming responses
- ✅ Full TypeScript type safety

## Documentation

For full documentation, visit: https://github.com/dashi0/agentwrap

## Changelog

See [CHANGELOG.md](https://github.com/dashi0/agentwrap/blob/master/docs/CHANGELOG.md) for release history and version updates.

## License

MIT
