/**
 * Dynamic MCP Server
 *
 * This module creates an MCP server that dynamically exposes user-provided
 * function definitions as MCP tools. When a tool is called, it records the
 * call and signals the agent to stop.
 */

import http from 'http';
import { EventEmitter } from 'events';
import type { ChatCompletionFunction } from './types.js';

interface MCPRequest<TParams = unknown> {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method: string;
  params?: TParams;
}

interface MCPResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: TResult;
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

export interface ToolCallRecord {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Event map for DynamicMcpServer.
 */
interface DynamicMcpServerEvents {
  terminate: (toolCalls: ToolCallRecord[]) => void;
  toolCall: (toolCall: ToolCallRecord) => void;
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
   * Type-safe event listener registration.
   */
  override on<K extends keyof DynamicMcpServerEvents>(
    event: K,
    listener: DynamicMcpServerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe one-time event listener registration.
   */
  override once<K extends keyof DynamicMcpServerEvents>(
    event: K,
    listener: DynamicMcpServerEvents[K]
  ): this {
    return super.once(event, listener);
  }

  /**
   * Type-safe event emission.
   */
  override emit<K extends keyof DynamicMcpServerEvents>(
    event: K,
    ...args: Parameters<DynamicMcpServerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
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
  handleRequest<TParams = unknown>(request: MCPRequest<TParams>): MCPResponse | null {
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
            id: id ?? null,
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
        id: id ?? null,
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
  private handleInitialize(id?: string | number | null): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
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
  private handleToolsList(id?: string | number | null): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
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
    id: string | number | null | undefined,
    params: { name: string; arguments: Record<string, unknown> }
  ): MCPResponse {
    const { name, arguments: args } = params;

    // Check if this exact tool call already exists (deduplicate)
    const argsString = JSON.stringify(args);
    const isDuplicate = this.toolCalls.some(
      (tc) => tc.function.name === name && tc.function.arguments === argsString
    );

    if (!isDuplicate) {
      // Generate unique tool call ID
      const toolCallId = `call_${Date.now()}_${this.nextToolCallId++}`;

      // Record the tool call
      const toolCall: ToolCallRecord = {
        id: toolCallId,
        function: {
          name,
          arguments: argsString,
        },
      };

      this.toolCalls.push(toolCall);

      // Emit event for monitoring
      this.emit('toolCall', toolCall);

      // Schedule agent termination (delayed to allow multiple tool calls)
      this.scheduleTermination();
    } else {
      console.log(`[DynamicMcpServer] Skipping duplicate tool call: ${name} with args ${argsString}`);
    }

    // Return success response (the actual function will be called by user process)
    return {
      jsonrpc: '2.0',
      id: id ?? null,
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
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    console.log(`[createMcpSseHandler] Received ${req.method} request to ${req.url}`);

    // Handle request body
    let body = '';
    req.on('data', (chunk) => {
      const chunkStr = chunk instanceof Buffer ? chunk.toString() : String(chunk);
      body += chunkStr;
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
          id: null,
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
