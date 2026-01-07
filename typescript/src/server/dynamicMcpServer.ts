/**
 * Dynamic MCP Server
 *
 * This module creates an MCP server that dynamically exposes user-provided
 * function definitions as MCP tools. When a tool is called, it records the
 * call and signals the agent to stop.
 */

import { EventEmitter } from 'events';
import type { ChatCompletionFunction } from './types.js';

interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolCallRecord {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Dynamic MCP Server that proxies user-defined functions.
 */
export class DynamicMcpServer extends EventEmitter {
  private functions: ChatCompletionFunction[];
  private toolCalls: ToolCallRecord[] = [];
  private killTimeout: NodeJS.Timeout | null = null;
  private nextToolCallId = 0;

  constructor(functions: ChatCompletionFunction[]) {
    super();
    this.functions = functions;
  }

  /**
   * Get the tools list in MCP format.
   */
  private getTools(): MCPTool[] {
    return this.functions.map((fn) => ({
      name: fn.name,
      description: fn.description || `User-defined function: ${fn.name}`,
      inputSchema: {
        type: 'object',
        properties: fn.parameters.properties,
        required: fn.parameters.required,
      },
    }));
  }

  /**
   * Handle MCP request.
   */
  handleRequest(request: MCPRequest): MCPResponse | null {
    const { method, id, params } = request;

    console.log(`[DynamicMcpServer] Received request: method=${method}, id=${id}`);

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'notifications/initialized':
          // Notification - no response needed
          console.log(`[DynamicMcpServer] Initialized notification received`);
          return null;

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          console.log(`[DynamicMcpServer] Tool call:`, params);
          return this.handleToolsCall(id, params as { name: string; arguments: Record<string, unknown> });

        default:
          console.log(`[DynamicMcpServer] Unknown method: ${method}`);
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      console.error(`[DynamicMcpServer] Error:`, error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Internal error: ${(error as Error).message}`,
        },
      };
    }
  }

  /**
   * Handle initialize request.
   */
  private handleInitialize(id?: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'agentwrap-dynamic-mcp',
          version: '1.0.0',
        },
      },
    };
  }

  /**
   * Handle tools/list request.
   */
  private handleToolsList(id?: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: this.getTools(),
      },
    };
  }

  /**
   * Handle tools/call request.
   *
   * This records the function call and schedules agent termination.
   */
  private handleToolsCall(
    id: string | number | undefined,
    params: { name: string; arguments: Record<string, unknown> }
  ): MCPResponse {
    const { name, arguments: args } = params;

    // Generate unique tool call ID
    const toolCallId = `call_${Date.now()}_${this.nextToolCallId++}`;

    // Record the tool call
    const toolCall: ToolCallRecord = {
      id: toolCallId,
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    };

    this.toolCalls.push(toolCall);

    // Emit event for monitoring
    this.emit('toolCall', toolCall);

    // Schedule agent termination (delayed to allow multiple tool calls)
    this.scheduleTermination();

    // Return success response (the actual function will be called by user process)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `[AgentWrap] Function ${name} will be executed by user process. Waiting for response...`,
          },
        ],
      },
    };
  }

  /**
   * Schedule agent termination.
   *
   * Delays termination to allow multiple tool calls to be collected.
   */
  private scheduleTermination(delayMs: number = 2000): void {
    // Clear existing timeout
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }

    // Schedule new timeout
    this.killTimeout = setTimeout(() => {
      this.emit('terminate', this.toolCalls);
    }, delayMs);
  }

  /**
   * Get recorded tool calls.
   */
  getToolCalls(): ToolCallRecord[] {
    return [...this.toolCalls];
  }

  /**
   * Clear recorded tool calls.
   */
  clearToolCalls(): void {
    this.toolCalls = [];
    this.nextToolCallId = 0;
  }

  /**
   * Cancel termination timeout.
   */
  cancelTermination(): void {
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
      this.killTimeout = null;
    }
  }
}

/**
 * Create HTTP handler for Streamable HTTP MCP endpoint (2025-03-26 spec).
 */
export function createMcpSseHandler(mcpServer: DynamicMcpServer) {
  return (req: any, res: any) => {
    console.log(`[createMcpSseHandler] Received ${req.method} request to ${req.url}`);

    // Handle request body
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const request = JSON.parse(body) as MCPRequest;
        console.log(`[createMcpSseHandler] Parsed request:`, JSON.stringify(request));

        // Check if this is a notification (method starts with "notifications/")
        const isNotification = request.method && request.method.startsWith('notifications/');

        if (isNotification) {
          // For notifications: return HTTP 202 Accepted with no body (Streamable HTTP spec)
          console.log(`[createMcpSseHandler] Notification received: ${request.method}`);
          res.writeHead(202, {
            'Content-Length': '0',
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
          return;
        }

        // For requests: set SSE headers and send JSON-RPC response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const response = mcpServer.handleRequest(request);

        if (response !== null) {
          // Send SSE message for normal requests
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        }

        // Close connection after sending response
        res.end();
      } catch (error) {
        const errorResponse: MCPResponse = {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error',
          },
        };
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
  };
}
