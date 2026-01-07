import {
  CodexAgent,
  AgentInput,
  OpenAICompatibleServer,
} from './src/index.js';

// ============================================================================
// Example 1: Basic Usage with agent.run()
// ============================================================================

async function example1_BasicRun() {
  console.log('\n=== Example 1: Basic agent.run() ===\n');

  // Create agent
  const agent = new CodexAgent();

  // Optional: Configure with API key and skills
  await agent.configure({
    agentConfig: {
      type: 'codex-agent',
      // apiKey: 'your-api-key', // Optional, defaults to env:OPENAI_API_KEY
    },
    skills: [
      // Anthropic Skill (markdown-based)
      {
        type: 'anthropic-skill',
        path: './tests/fixtures/skills/echo_skill',
      },
    ],
  });

  console.log('Query: Use the echo skill to repeat "Hello from AgentWrap!"\n');
  console.log('Response:');

  // Notice: passing string directly (no need for AgentInput.fromQuery())
  for await (const event of agent.run('Use the echo skill to repeat this message: "Hello from AgentWrap!"')) {
    console.log(JSON.stringify(event));
  }

  console.log('\n');
}

// ============================================================================
// Example 2: Structured Output & Conversation
// ============================================================================

async function example2_StructuredAndConversation() {
  console.log('\n=== Example 2: Structured Output & Conversation ===\n');

  const agent = new CodexAgent();

  await agent.configure({
    agentConfig: {
      type: 'codex-agent',
      // apiKey: 'your-api-key', // Optional, defaults to env:OPENAI_API_KEY
    },
    skills: [
      // MCP Server (stdio transport)
      {
        type: 'mcp',
        transport: 'stdio',
        command: 'node',
        args: ['./tests/fixtures/mcp_servers/echo_server.cjs'],
        name: 'echo_mcp',
      },
    ],
  });


  const schema = {
    type: 'object',
    properties: {
      country: { type: 'string' },
      capital: { type: 'string' },
      population: { type: 'number' },
      funFact: { type: 'string' },
    },
    required: ['country', 'capital', 'population', 'funFact'],
  };


  const messages = [
    { role: 'user' as const, content: 'What is the capital of Japan?' },
    { role: 'assistant' as const, content: 'Tokyo' },
    { role: 'user' as const, content: 'Respond to me via JSON about Japan: its capital, approximate population, and a fun fact.' },
  ];

  const conversationInput = AgentInput.fromMessages(messages);

  for (const msg of messages) {
    console.log(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
  }
  console.log('Assistant: ');

  const result = await agent.runStructured(conversationInput, schema);

  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n');
}

// ============================================================================
// Example 3: HTTP Server with OpenAI-Compatible API
// ============================================================================

async function example3_HttpServer() {
  console.log('\n=== Example 3: HTTP Server ===\n');

  // 1. Create and configure the agent
  const agent = new CodexAgent();
  await agent.configure({
    agentConfig: {
      type: 'codex-agent',
      // apiKey: 'your-api-key', // Optional, defaults to env:OPENAI_API_KEY
    },
    skills: [
      // Anthropic Skill
      {
        type: 'anthropic-skill',
        path: './tests/fixtures/skills/echo_skill',
      },
    ],
  });

  // 2. Create the OpenAI-compatible server
  const server = new OpenAICompatibleServer(agent);

  // 3. Start HTTP server
  const port = 3000;
  await server.startHttpServer({ port, host: '127.0.0.1' });

  console.log(`✅ OpenAI-compatible server started!

Available endpoints:
- GET  http://localhost:${port}/health              - Health check
- POST http://localhost:${port}/v1/chat/completions - Chat completion

Try with curl:
  curl http://localhost:${port}/health

  curl http://localhost:${port}/v1/models

  curl -X POST http://localhost:${port}/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{
      "model": "agentwrap-codex",
      "messages": [
        {"role": "user", "content": "Call echo skill to repeat \\"Hello from AgentWrap!\\""}
      ],
      "stream": true
    }'

Press Ctrl+C to stop the server.
`);

  // Keep process alive
  await new Promise(() => {});
}


// ============================================================================
// Main: Run Examples
// ============================================================================

async function main() {
  const examples = [
    { name: 'basic', fn: example1_BasicRun },
    { name: 'structured', fn: example2_StructuredAndConversation },
    { name: 'server', fn: example3_HttpServer },
  ];
  for (const example of examples) {
    try {
      await example.fn();
    } catch (err) {
      console.error(`Error in example "${example.name}":`, err);
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
