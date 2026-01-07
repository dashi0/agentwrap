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
import type { AllAgentConfigs } from './config.js';
import { isMessageEvent } from './events.js';
import { dynamicMcpBridge } from './server/dynamicMcpBridge.js';
import type { ChatCompletionFunction } from './server/types.js';
import { Prompts } from './prompts.js';

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

export abstract class BaseServer<TRequest = unknown, TResponse = unknown> {
  private app?: Express;
  private httpServer?: http.Server;
  protected agent?: BaseAgent;
  protected prompts: Prompts;

  constructor(agent?: BaseAgent, prompts?: Prompts) {
    this.agent = agent;
    this.prompts = prompts || new Prompts();
  }

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
  protected abstract convertRequestToRawPrompt(request: TRequest): string;

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
