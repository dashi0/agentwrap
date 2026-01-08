/**
 * Dynamic MCP Server for OpenAI Chat Completion Compatible API
 *
 * Problem: How to enable codex-cli agent to call back user-defined functions?
 *
 * Call stack:
 *   User process (frontend JS, provides function definitions & implementations)
 *        ↓ HTTP request with tools/functions
 *   AgentWrap HTTP server (this module)
 *        ↓ spawn codex-cli with injected dynamic MCP
 *   Codex-cli agent (with its own configured skills/tools)
 *        ↑ needs to call user-defined functions somehow
 *
 * Solution:
 * 1. When OpenAI API request arrives with function definitions:
 *    - Create a dynamic MCP server listening on 127.0.0.1 (Streamable HTTP)
 *    - Convert user's function definitions into MCP tools
 *    - Inject this MCP server into codex-cli via -c flag (name: Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME)
 *
 * 2. When codex-cli calls these dynamic MCP tools:
 *    - Mark "user-defined function called" in-process
 *    - Terminate codex-cli execution (with delay for multi-tool calls)
 *    - Return OpenAI function_call response format to user
 *
 * 3. On next turn (user provides function results):
 *    - Translate function call history into prompt context
 *    - Continue conversation with codex-cli
 *
 * This enables bidirectional function calling between user process and agent.
 *
 * Implementation notes:
 * - Single global HTTP server (avoid multiple ports for concurrent requests)
 * - Each request gets unique ID, function names prefixed with requestId (format: {requestId}_{functionName})
 * - Multiple concurrent requests can coexist without conflict
 * - Agent sees functions as: userDefinedFunctions.{requestId}_* in prompts for better identification
 */

import http from 'http';
import { randomBytes } from 'crypto';
import { DynamicMcpServer } from './dynamicMcpServer.js';
import type { ChatCompletionFunction } from './types.js';
import { Prompts } from '../prompts.js';

/**
 * MCP JSON-RPC request structure.
 */
interface MCPRequest<TParams = unknown> {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method: string;
  params?: TParams;
}

/**
 * MCP JSON-RPC response structure.
 */
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

/**
 * MCP tools/call request params.
 */
interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * MCP tool definition.
 */
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Context for each OpenAI chat completion request.
 * Tracks function definitions and their MCP server instance.
 */
export interface RequestContext {
  requestId: string;
  mcpServer: DynamicMcpServer;
  originalFunctions: ChatCompletionFunction[];
  functionNameMap: Map<string, string>; // prefixed -> original
}

/**
 * Manages dynamic MCP servers for user-defined functions in OpenAI API requests.
 *
 * This singleton handles the lifecycle of temporary MCP servers that bridge
 * user-defined functions with codex-cli agent.
 */
class DynamicMcpBridge {
  private httpServer: http.Server | null = null;
  private serverPort: number | null = null;
  private serverHost: string = '127.0.0.1';
  private requests: Map<string, RequestContext> = new Map();

  /**
   * Get or create the global HTTP server for dynamic MCP bridge.
   */
  async ensureServerStarted(host: string = '127.0.0.1', port: number = 0): Promise<number> {
    if (this.httpServer && this.serverPort !== null) {
      return this.serverPort;
    }

    return new Promise((resolve, reject) => {
      this.serverHost = host;

      this.httpServer = http.createServer((req, res) => {
        console.log(`[DynamicMcpBridge] Received ${req.method} ${req.url}`);

        // Handle OAuth discovery
        if (req.method === 'GET' && req.url === '/.well-known/oauth-authorization-server') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({}));
          return;
        }

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }

        // Handle POST requests
        if (req.method === 'POST') {
          this.handleRequest(req, res);
        } else {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
        }
      });

      this.httpServer.listen(port, host, () => {
        const address = this.httpServer!.address();
        this.serverPort = typeof address === 'object' && address ? address.port : port;
        console.log(`[DynamicMcpBridge] HTTP server started on ${host}:${this.serverPort}`);
        resolve(this.serverPort);
      });

      this.httpServer.on('error', reject);
    });
  }

  /**
   * Register a new OpenAI request with user-defined functions.
   * Creates a dynamic MCP server instance for this request.
   */
  registerRequest(functions: ChatCompletionFunction[]): RequestContext {
    const requestId = randomBytes(6).toString('hex');

    // Add prefix to function names to avoid conflicts between concurrent requests
    // Format: {requestId}_{originalName} so agent can identify them
    const functionNameMap = new Map<string, string>();
    const prefixedFunctions = functions.map((fn) => {
      const prefixedName = `${requestId}_${fn.name}`;
      functionNameMap.set(prefixedName, fn.name);

      return {
        ...fn,
        name: prefixedName,
      };
    });

    // Create dynamic MCP server for these user-defined functions
    const mcpServer = new DynamicMcpServer(prefixedFunctions);

    const context: RequestContext = {
      requestId,
      mcpServer,
      originalFunctions: functions,
      functionNameMap,
    };

    this.requests.set(requestId, context);

    console.log(
      `[DynamicMcpBridge] Registered request ${requestId} with user functions:`,
      functions.map((f) => f.name)
    );

    return context;
  }

  /**
   * Unregister a request and cleanup its dynamic MCP server.
   */
  unregisterRequest(requestId: string): void {
    const context = this.requests.get(requestId);
    if (context) {
      context.mcpServer.cancelTermination();
      this.requests.delete(requestId);
      console.log(`[DynamicMcpBridge] Unregistered request ${requestId}`);
    }
  }

  /**
   * Handle incoming HTTP request.
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      const chunkStr = chunk instanceof Buffer ? chunk.toString() : String(chunk);
      body += chunkStr;
    });

    req.on('end', () => {
      try {
        const request = JSON.parse(body) as MCPRequest;
        console.log(`[DynamicMcpBridge] MCP request:`, JSON.stringify(request));

        // Check if notification
        const isNotification = request.method && request.method.startsWith('notifications/');

        if (isNotification) {
          // Return HTTP 202 Accepted for notifications (Streamable HTTP spec)
          console.log(`[DynamicMcpBridge] Notification: ${request.method}`);
          res.writeHead(202, {
            'Content-Length': '0',
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
          return;
        }

        // For requests: handle with appropriate method
        if (request.method === 'initialize') {
          this.handleInitialize(request, res);
        } else if (request.method === 'tools/list') {
          this.handleToolsList(request, res);
        } else if (request.method === 'tools/call') {
          this.handleToolsCall(request as MCPRequest<ToolsCallParams>, res);
        } else {
          // Unknown method
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          res.write(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `Method not found: ${request.method}` },
            })}\n\n`
          );
          res.end();
        }
      } catch (error) {
        console.error(`[DynamicMcpBridge] Error:`, error);
        res.writeHead(500);
        res.end();
      }
    });
  }

  /**
   * Handle initialize request.
   */
  private handleInitialize(request: MCPRequest, res: http.ServerResponse): void {
    // Return standard initialize response
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME, version: '1.0.0' },
      },
    };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`data: ${JSON.stringify(response)}\n\n`);
    res.end();
  }

  /**
   * Handle tools/list by aggregating all user-defined functions from all active requests.
   */
  private handleToolsList(request: MCPRequest, res: http.ServerResponse): void {
    const allTools: MCPTool[] = [];

    // Aggregate tools from all concurrent requests
    for (const context of this.requests.values()) {
      const response = context.mcpServer.handleRequest(request);
      if (response?.result && typeof response.result === 'object' && 'tools' in response.result) {
        const tools = (response.result as { tools?: unknown }).tools;
        if (Array.isArray(tools)) {
          allTools.push(...(tools as MCPTool[]));
        }
      }
    }

    const responseData: MCPResponse<{ tools: MCPTool[] }> = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: { tools: allTools },
    };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`data: ${JSON.stringify(responseData)}\n\n`);
    res.end();
  }

  /**
   * Handle tools/call by routing to the correct server.
   */
  private handleToolsCall(request: MCPRequest<ToolsCallParams>, res: http.ServerResponse): void {
    const functionName = request.params?.name;

    if (!functionName) {
      res.writeHead(400);
      res.end('Missing function name');
      return;
    }

    // Find the request context that has this function
    for (const context of this.requests.values()) {
      if (context.functionNameMap.has(functionName)) {
        // Handle the tool call with this context's server
        const response = context.mcpServer.handleRequest(request);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });

        if (response) {
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        }

        res.end();
        return;
      }
    }

    // Function not found
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    res.write(
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${functionName}` },
      })}\n\n`
    );

    res.end();
  }

  /**
   * Get the current server port (null if not started).
   */
  getPort(): number | null {
    return this.serverPort;
  }

  /**
   * Get the server host.
   */
  getHost(): string {
    return this.serverHost;
  }

  /**
   * Remove prefix from function name to get original name.
   * Works with both old suffix format (name_id) and new prefix format (id_name).
   */
  removeFunctionPrefix(prefixedName: string): string {
    // Find the context that has this function
    for (const context of this.requests.values()) {
      const originalName = context.functionNameMap.get(prefixedName);
      if (originalName) {
        return originalName;
      }
    }

    // If not found, return as-is (shouldn't happen)
    return prefixedName;
  }

  /**
   * Get request context by function name.
   */
  getContextByFunctionName(functionName: string): RequestContext | undefined {
    for (const context of this.requests.values()) {
      if (context.functionNameMap.has(functionName)) {
        return context;
      }
    }
    return undefined;
  }
}

// Export singleton instance
export const dynamicMcpBridge = new DynamicMcpBridge();
