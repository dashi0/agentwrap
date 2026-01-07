/**
 * OpenAI Compatible Server
 *
 * Adapts any BaseAgent implementation to provide OpenAI Chat Completion
 * compatible interface. This is NOT an agent itself, but a server/adapter
 * that converts OpenAI API requests into agent calls.
 *
 * Works in-process without needing an HTTP server - useful for:
 * - Testing
 * - Direct API usage
 * - Embedding in applications
 */

import { randomUUID } from 'crypto';
import type { Express, Request, Response } from 'express';
import { BaseAgent } from '../agent.js';
import { BaseServer } from '../server.js';
import { AgentInput } from '../config.js';
import {
  convertFunctionCallHistoryToPrompt,
  mergeFunctionResults,
} from '../server/functionCallHandler.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChoice,
  ChatCompletionAssistantMessage,
  ChatCompletionToolCall,
  ChatCompletionFunction,
} from '../server/types.js';
import {
  isMessageEvent,
  isReasoningEvent,
  isCommandExecutionEvent,
  isSkillInvokedEvent,
} from '../events.js';

export interface OpenAIServerOptions {
  mcpServerPort?: number;
  mcpServerHost?: string;
  terminationDelayMs?: number;
  /**
   * Optional bypass callback executed before handleRequest.
   * Can be used to bypass agent logic for certain requests (e.g., proxy to OpenAI directly).
   *
   * - Returns true: agent logic is bypassed (response already written to res)
   * - Returns false: proceeds with normal agent logic
   *
   * The callback is responsible for writing to res if it returns true.
   *
   * @param request - Parsed ChatCompletionRequest body
   * @param req - Raw Express Request (for headers, cookies, etc.)
   * @param res - Express Response
   */
  bypassRequest?: (
    request: ChatCompletionRequest,
    req: Request,
    res: Response
  ) => Promise<boolean>;
}

interface InternalHandlerOptions {
  mcpServerPort: number;
  mcpServerHost: string;
  terminationDelayMs: number;
}

/**
 * OpenAI Compatible Server - Adapts any agent to OpenAI Chat Completion API
 *
 * Example usage:
 * ```typescript
 * const agent = new CodexAgent();
 * await agent.configure(config);
 *
 * const server = new OpenAICompatibleServer(agent);
 * const response = await server.handleRequest(request);
 * ```
 */
export class OpenAICompatibleServer extends BaseServer<
  ChatCompletionRequest,
  ChatCompletionResponse
> {
  private options: InternalHandlerOptions;
  private bypassRequest?: (
    request: ChatCompletionRequest,
    req: Request,
    res: Response
  ) => Promise<boolean>;

  constructor(agent: BaseAgent, options: OpenAIServerOptions = {}) {
    super();
    this.agent = agent; // Set agent in BaseServer
    this.options = {
      mcpServerPort: options.mcpServerPort ?? 0, // 0 = random port
      mcpServerHost: options.mcpServerHost ?? '127.0.0.1',
      terminationDelayMs: options.terminationDelayMs ?? 2000,
    };
    this.bypassRequest = options.bypassRequest;
  }

  /**
   * Register OpenAI-specific HTTP routes.
   */
  protected override registerRoutes(app: Express): void {
    // POST /v1/chat/completions - OpenAI Chat Completion endpoint
    app.post('/v1/chat/completions', async (req: Request, res: Response) => {
      try {
        const request = req.body as ChatCompletionRequest;

        // Optional bypass: call bypassRequest if provided
        if (this.bypassRequest) {
          const bypassed = await this.bypassRequest(request, req, res);
          // If bypassed, stop here (callback already wrote to res)
          if (bypassed) {
            return;
          }
          // Otherwise, proceed with normal agent logic
        }

        // handleRequest handles both streaming and non-streaming output
        await this.handleRequest(request, res);
      } catch (error) {
        console.error('[OpenAICompatibleServer] Error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              message: error instanceof Error ? error.message : 'Internal server error',
              type: 'internal_error',
              code: 'internal_error',
            },
          });
        }
      }
    });
  }

  /**
   * Handle OpenAI Chat Completion request.
   *
   * This method:
   * 1. Checks if streaming is requested
   * 2. For streaming: writes SSE chunks to res and returns void
   * 3. For non-streaming: returns ChatCompletionResponse
   * 4. Handles function calling if tools/functions are provided
   */
  override async handleRequest(
    request: ChatCompletionRequest,
    res?: Response
  ): Promise<ChatCompletionResponse> {
    // Check for function calling - uses different logic
    const functions = this.extractFunctions(request);
    if (functions.length > 0) {
      return this.handleWithFunctionCalls(request, functions);
    }

    // ===== Unified event processing (streaming vs non-streaming) =====
    const isStreaming = request.stream;
    const responseId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    // Setup streaming headers if needed
    if (isStreaming && res) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send initial chunk with role
      res.write(
        `data: ${JSON.stringify({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model: request.model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })}\n\n`
      );
    }

    // Convert request to prompt and run agent
    const prompt = this.convertRequestToPrompt(request);
    const agentInput = AgentInput.fromQuery(prompt);

    const collectedContent: string[] = [];

    try {
      // Process events - single loop for both streaming and non-streaming
      for await (const event of this.agent!.run(agentInput)) {
        let contentChunk: string | null = null;

        // Convert event to content
        if (isReasoningEvent(event)) {
          contentChunk = `[Reasoning] ${event.content}\n`;
        } else if (isCommandExecutionEvent(event)) {
          contentChunk = `[Command] ${event.command}\n${event.output ? event.output + '\n' : ''}`;
        } else if (isSkillInvokedEvent(event)) {
          contentChunk = `[Skill] ${event.skillName}\n`;
        } else if (isMessageEvent(event)) {
          contentChunk = event.content;
        }

        if (contentChunk) {
          // Collect message content for final response (both streaming and non-streaming)
          if (isMessageEvent(event)) {
            collectedContent.push(contentChunk);
          }

          // Streaming: also output all event types immediately
          if (isStreaming && res) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{ index: 0, delta: { content: contentChunk }, finish_reason: null }],
              })}\n\n`
            );
          }
        }
      }

      // Finalize response
      const content = collectedContent.join('');
      const normalResponse = this.createNormalResponse(request, content);

      if (res) {
        // HTTP usage: write to res
        if (isStreaming) {
          // Send final chunk and [DONE]
          res.write(
            `data: ${JSON.stringify({
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model: request.model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          // Non-streaming: send JSON
          res.json(normalResponse);
        }
      }

      // Always return response (both streaming and non-streaming)
      return normalResponse;
    } catch (error) {
      if (res) {
        if (isStreaming) {
          console.error('[OpenAICompatibleServer] Streaming error:', error);
          res.write(
            `data: ${JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : 'Streaming error',
                type: 'internal_error',
              },
            })}\n\n`
          );
          res.end();
        } else {
          res.status(500).json({
            error: {
              message: error instanceof Error ? error.message : 'Internal server error',
              type: 'internal_error',
            },
          });
        }
      }
      // Re-throw for caller to handle
      throw error;
    }
  }

  /**
   * Extract function definitions from request.
   */
  private extractFunctions(request: ChatCompletionRequest): ChatCompletionFunction[] {
    const functions: ChatCompletionFunction[] = [];

    // New tools format
    if (request.tools) {
      for (const tool of request.tools) {
        if (tool.type === 'function') {
          functions.push(tool.function);
        }
      }
    }

    // Legacy functions format
    if (request.functions) {
      functions.push(...request.functions);
    }

    return functions;
  }

  /**
   * Convert OpenAI request to prompt string.
   */
  protected convertRequestToPrompt(request: ChatCompletionRequest): string {
    // Prepare messages (merge function results if present)
    const messages = mergeFunctionResults(request.messages);
    // Convert to prompt
    return convertFunctionCallHistoryToPrompt(messages);
  }

  /**
   * Create OpenAI function call response.
   */
  protected createToolCallResponse(
    request: ChatCompletionRequest,
    toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>
  ): ChatCompletionResponse {
    const responseId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    // Convert to OpenAI format tool calls
    const openaiToolCalls: ChatCompletionToolCall[] = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    const assistantMessage: ChatCompletionAssistantMessage = {
      role: 'assistant',
      content: null,
      tool_calls: openaiToolCalls,
    };

    const choice: ChatCompletionChoice = {
      index: 0,
      message: assistantMessage,
      finish_reason: 'tool_calls',
    };

    return {
      id: responseId,
      object: 'chat.completion',
      created,
      model: request.model,
      choices: [choice],
    };
  }

  /**
   * Create OpenAI normal response.
   */
  protected createNormalResponse(
    request: ChatCompletionRequest,
    content: string
  ): ChatCompletionResponse {
    const responseId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    const assistantMessage: ChatCompletionAssistantMessage = {
      role: 'assistant',
      content,
    };

    const choice: ChatCompletionChoice = {
      index: 0,
      message: assistantMessage,
      finish_reason: 'stop',
    };

    return {
      id: responseId,
      object: 'chat.completion',
      created,
      model: request.model,
      choices: [choice],
    };
  }

  /**
   * Handle request with function calls (delegates to BaseServer core logic).
   */
  private async handleWithFunctionCalls(
    request: ChatCompletionRequest,
    functions: ChatCompletionFunction[]
  ): Promise<ChatCompletionResponse> {
    return this.handleWithFunctionCallingCore(request, functions, {
      mcpServerHost: this.options.mcpServerHost,
      mcpServerPort: this.options.mcpServerPort,
    });
  }

}
