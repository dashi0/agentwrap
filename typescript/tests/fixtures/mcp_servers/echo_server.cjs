#!/usr/bin/env node
/**
 * Simple MCP server for testing.
 *
 * Provides an echo tool that returns whatever is sent to it.
 */

const readline = require('readline');

function sendMessage(message) {
  /** Send a JSON-RPC message to stdout. */
  console.log(JSON.stringify(message));
}

function handleInitialize(request) {
  /** Handle initialize request. */
  sendMessage({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'echo-server',
        version: '1.0.0',
      },
    },
  });
}

function handleToolsList(request) {
  /** Handle tools/list request. */
  sendMessage({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: [
        {
          name: 'echo',
          description: 'Echoes back the input message',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to echo back',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'reverse',
          description: 'Reverses the input string',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Text to reverse',
              },
            },
            required: ['text'],
          },
        },
      ],
    },
  });
}

function handleToolsCall(request) {
  /** Handle tools/call request. */
  const params = request.params || {};
  const toolName = params.name;
  const args = params.arguments || {};

  let result;

  if (toolName === 'echo') {
    const message = args.message || '';
    result = {
      content: [
        {
          type: 'text',
          text: `Echo: ${message}`,
        },
      ],
    };
  } else if (toolName === 'reverse') {
    const text = args.text || '';
    const reversedText = text.split('').reverse().join('');
    result = {
      content: [
        {
          type: 'text',
          text: reversedText,
        },
      ],
    };
  } else {
    sendMessage({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`,
      },
    });
    return;
  }

  sendMessage({
    jsonrpc: '2.0',
    id: request.id,
    result: result,
  });
}

function main() {
  /** Main server loop. */
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) {
      return;
    }

    try {
      const request = JSON.parse(line);
      const method = request.method;

      if (method === 'initialize') {
        handleInitialize(request);
      } else if (method === 'tools/list') {
        handleToolsList(request);
      } else if (method === 'tools/call') {
        handleToolsCall(request);
      } else {
        // Unknown method
        sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendMessage({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        });
      } else {
        sendMessage({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: `Internal error: ${err.message}`,
          },
        });
      }
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  handleInitialize,
  handleToolsList,
  handleToolsCall,
};
