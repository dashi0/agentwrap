/**
 * Base Server Interface
 *
 * Similar to BaseAgent, this defines the interface that all server
 * implementations must follow.
 *
 * A server adapts an agent to provide a specific API format.
 * Examples: OpenAI Chat Completion API, Anthropic Messages API, etc.
 *
 * Provides both in-process usage (via handleRequest()) and HTTP server
 * capabilities with common routes.
 */

import express from 'express';
import type { Express, Request, Response } from 'express';
import http from 'http';
import { BaseAgent } from './agent.js';
import { AgentInput } from './config.js';
import type { AllAgentConfigs } from './config.js';
import { isMessageEvent } from './events.js';
import { dynamicMcpBridge } from './server/dynamicMcpBridge.js';
import type { ChatCompletionFunction } from './server/types.js';

export interface HttpServerOptions {
  port?: number;
  host?: string;
}

export interface FunctionCallingOptions {
  mcpServerHost: string;
  mcpServerPort: number;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export abstract class BaseServer<TRequest = any, TResponse = any> {
  private app?: Express;
  private httpServer?: http.Server;
  protected agent?: BaseAgent;

  /**
   * Handle a request and return a response.
   *
   * The specific format depends on the server implementation.
   * This method is used for both in-process usage and HTTP routes.
   *
   * @param request - The request to handle
   * @param res - Optional Express Response for streaming/HTTP output
   * @returns Response object (always returned, even when writing to res)
   */
  abstract handleRequest(request: TRequest, res?: Response): Promise<TResponse>;

  /**
   * Convert request to prompt string.
   * Subclasses must implement this to handle their specific request format.
   */
  protected abstract convertRequestToPrompt(request: TRequest): string;

  /**
   * Create response for function/tool calls.
   * Subclasses must implement this to format tool calls in their API format.
   */
  protected abstract createToolCallResponse(
    request: TRequest,
    toolCalls: ToolCall[]
  ): TResponse;

  /**
   * Create normal (non-function-call) response.
   * Subclasses must implement this to format text content in their API format.
   */
  protected abstract createNormalResponse(
    request: TRequest,
    content: string
  ): TResponse;

  /**
   * Core function calling logic (shared across all server implementations).
   *
   * Handles the common flow:
   * 1. Register functions with dynamic MCP bridge
   * 2. Start MCP server
   * 3. Inject MCP skill into agent
   * 4. Run agent with function calling capability
   * 5. Return either function calls or final response
   * 6. Cleanup
   */
  protected async handleWithFunctionCallingCore(
    request: TRequest,
    functions: ChatCompletionFunction[],
    options: FunctionCallingOptions
  ): Promise<TResponse> {
    if (!this.agent) {
      throw new Error('Agent not set. Subclass must set this.agent in constructor.');
    }

    // Register request with dynamic MCP bridge (adds suffix to function names)
    const context = dynamicMcpBridge.registerRequest(functions);

    // Ensure dynamic MCP bridge HTTP server is started
    const port = await dynamicMcpBridge.ensureServerStarted(
      options.mcpServerHost,
      options.mcpServerPort
    );

    try {
      console.log(
        `[BaseServer] Using dynamic MCP bridge on ${options.mcpServerHost}:${port}`
      );
      console.log(
        `[BaseServer] Request ${context.requestId} functions:`,
        functions.map((f) => f.name)
      );

      // Convert request to prompt (format-specific)
      const prompt = this.convertRequestToPrompt(request);
      const agentInput = AgentInput.fromQuery(prompt);

      // Create temporary dynamic MCP skill for function calling
      // This is NOT written to config file, only passed via configOverrides
      const dynamicMcpSkill = {
        type: 'mcp' as const,
        transport: 'streamable-http' as const,
        url: `http://${options.mcpServerHost}:${port}`,
        name: 'userDefinedFunctions', // Fixed name for dynamic MCP
      };

      // Build configOverrides with dynamic MCP skill
      // Note: We inject this dynamically without modifying the agent's base config
      const configOverrides: Partial<AllAgentConfigs> = {
        skills: [dynamicMcpSkill],
      };

      // Set up termination handler
      let terminated = false;
      const terminationPromise = new Promise<ToolCall[]>((resolve) => {
        context.mcpServer.once('terminate', (toolCalls) => {
          terminated = true;
          resolve(toolCalls);
        });
      });

      // Run agent with configOverrides (dynamic MCP passed via -c flags)
      const agentPromise = this.runAgentCore(agentInput, configOverrides);

      // Wait for either agent completion or termination
      const result = await Promise.race([agentPromise, terminationPromise]);

      // If terminated (function calls detected)
      if (terminated || Array.isArray(result)) {
        const toolCalls = Array.isArray(result)
          ? result
          : context.mcpServer.getToolCalls();

        // Remove suffix from function names before returning
        const originalToolCalls = toolCalls.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            name: dynamicMcpBridge.removeFunctionSuffix(tc.function.name),
          },
        }));

        // Return function call response (format-specific)
        return this.createToolCallResponse(request, originalToolCalls);
      } else {
        // Agent completed normally
        const content = result as string;
        return this.createNormalResponse(request, content);
      }
    } finally {
      // Cleanup: unregister request (but keep dynamic MCP bridge running)
      dynamicMcpBridge.unregisterRequest(context.requestId);
    }
  }

  /**
   * Run agent and collect output (shared logic).
   */
  protected async runAgentCore(
    agentInput: any,
    configOverrides?: Partial<AllAgentConfigs>
  ): Promise<string> {
    if (!this.agent) {
      throw new Error('Agent not set. Subclass must set this.agent in constructor.');
    }

    const messages: string[] = [];

    for await (const event of this.agent.run(agentInput, configOverrides)) {
      if (isMessageEvent(event)) {
        messages.push(event.content);
      }
    }

    return messages.join('\n\n');
  }

  /**
   * Register custom HTTP routes.
   *
   * Subclasses can override this to add their specific routes
   * (e.g., /v1/chat/completions for OpenAI).
   */
  protected registerRoutes(_app: Express): void {
    // Override in subclass to add custom routes
  }

  /**
   * Start HTTP server with common routes.
   *
   * Common routes provided:
   * - GET /health - Health check endpoint
   * - GET /v1/models - List available models
   */
  async startHttpServer(options: HttpServerOptions = {}): Promise<http.Server> {
    const { port = 3000, host = '0.0.0.0' } = options;

    // Create Express app
    this.app = express();
    this.app.use(express.json());

    // Common routes
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'agentwrap',
        version: '0.1.0',
      });
    });

    this.app.get('/v1/models', (_req: Request, res: Response) => {
      res.json({
        object: 'list',
        data: [
          {
            id: 'agentwrap-codex',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'agentwrap',
          },
        ],
      });
    });

    // Let subclass register custom routes
    this.registerRoutes(this.app);

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer = this.app!.listen(port, host, () => {
        console.log(`[BaseServer] HTTP server listening on ${host}:${port}`);
        resolve(this.httpServer!);
      });

      this.httpServer.on('error', reject);
    });
  }

  /**
   * Stop HTTP server.
   */
  async stopHttpServer(): Promise<void> {
    if (this.httpServer) {
      return new Promise((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('[BaseServer] HTTP server stopped');
            this.httpServer = undefined;
            this.app = undefined;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Get the Express app instance (for testing or advanced usage).
   */
  protected getApp(): Express | undefined {
    return this.app;
  }
}
