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
import { Prompts } from '../prompts.js';
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
import { dynamicMcpBridge } from '../server/dynamicMcpBridge.js';

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

  constructor(agent: BaseAgent, options: OpenAIServerOptions = {}, prompts?: Prompts) {
    super(agent, prompts);
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
    app.post('/v1/chat/completions', (req: Request, res: Response) => {
      void (async () => {
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
      })();
    });
  }

  /**
   * Handle OpenAI Chat Completion request.
   *
   * This method uses a unified processing path for all requests:
   * 1. If functions are provided, sets up MCP bridge conditionally
   * 2. Runs agent with unified event processing
   * 3. Returns tool_calls response if functions were called, otherwise normal response
   * 4. Supports both streaming and non-streaming modes
   */
  override async handleRequest(
    request: ChatCompletionRequest,
    res?: Response
  ): Promise<ChatCompletionResponse> {
    // Extract functions (if any)
    const functions = this.extractFunctions(request);
    const isStreaming = request.stream;
    const responseId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    // Setup MCP bridge conditionally if functions are provided
    let mcpContext: any = null;
    let configOverrides: any = undefined;
    let terminated = false;
    let toolCalls: any[] = [];

    if (functions.length > 0) {
      // Register request with dynamic MCP bridge (must do this first to get requestId)
      mcpContext = dynamicMcpBridge.registerRequest(functions);

      // Ensure MCP server is started
      const port = await dynamicMcpBridge.ensureServerStarted(
        this.options.mcpServerHost,
        this.options.mcpServerPort
      );

      console.log(
        `[OpenAICompatibleServer] Using dynamic MCP bridge on ${this.options.mcpServerHost}:${port}`
      );
      console.log(
        `[OpenAICompatibleServer] Request ${mcpContext.requestId} functions:`,
        functions.map((f) => f.name)
      );

      // Create temporary dynamic MCP skill
      const dynamicMcpSkill = {
        type: 'mcp' as const,
        transport: 'streamable-http' as const,
        url: `http://${this.options.mcpServerHost}:${port}`,
        name: Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME,
      };

      configOverrides = { skills: [dynamicMcpSkill] };
    }

    // Convert request to prompt (with tool calling instructions if functions are provided)
    const basePrompt = this.convertRequestToRawPrompt(request);
    const prompt = functions.length > 0 && mcpContext
      ? this.prompts.prependToolCallingInstructions(basePrompt, functions, mcpContext.requestId)
      : basePrompt;

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

    const collectedContent: string[] = [];

    try {
      // If functions are provided, use Promise.race to handle termination immediately
      if (functions.length > 0 && mcpContext) {
        // Create termination promise
        const terminationPromise = new Promise<void>((resolve) => {
          mcpContext.mcpServer.once('terminate', (calls: any[]) => {
            terminated = true;
            toolCalls = calls;
            resolve();
          });
        });

        // Create agent execution promise
        const agentPromise = (async () => {
          for await (const event of this.agent!.runRaw(prompt, { configOverrides })) {
            // Check if terminated by tool calls - stop processing if so
            if (terminated) {
              break;
            }

            const contentChunk = this.convertEventToContentChunk(event);
            if (contentChunk) {
              // Collect message content for final response
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
        })();

        // Use Promise.race to wait for whichever completes first:
        // - Either agent termination (via MCP function call)
        // - Or agent completing normally
        await Promise.race([terminationPromise, agentPromise]);

        // Give terminate event a moment to fire if it hasn't yet
        if (!terminated) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        // No functions - normal event processing
        for await (const event of this.agent!.runRaw(prompt, { configOverrides })) {
          const contentChunk = this.convertEventToContentChunk(event);
          if (contentChunk) {
            // Collect message content for final response
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
      }

      // Return response based on whether functions were called
      if (terminated && mcpContext) {
        console.log('[OpenAICompatibleServer] Function calls detected');

        // Function calls were made - return tool_calls response
        // Remove prefix from function names
        const originalToolCalls = toolCalls.map((tc) => ({
          ...tc,
          function: {
            ...tc.function,
            name: dynamicMcpBridge.removeFunctionPrefix(tc.function.name),
          },
        }));

        const toolCallResponse = this.createToolCallResponse(request, originalToolCalls);

        if (res) {
          if (isStreaming) {
            // For streaming, send tool calls as delta and end
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              })}\n\n`
            );
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            res.json(toolCallResponse);
          }
        }

        return toolCallResponse;
      } else {
        // Normal response - no function calls
        const content = collectedContent.join('');
        const normalResponse = this.createNormalResponse(request, content);

        if (res) {
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
            res.json(normalResponse);
          }
        }

        return normalResponse;
      }
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
      throw error;
    } finally {
      // Cleanup MCP context if it was created
      if (mcpContext) {
        dynamicMcpBridge.unregisterRequest(mcpContext.requestId);
      }
    }
  }

  /**
   * Convert agent event to content chunk.
   * Extracted to avoid duplication in event processing loops.
   */
  private convertEventToContentChunk(event: any): string | null {
    if (isReasoningEvent(event)) {
      return `[Reasoning] ${event.content}\n`;
    } else if (isCommandExecutionEvent(event)) {
      return `[Command] ${event.command}\n${event.output ? event.output + '\n' : ''}`;
    } else if (isSkillInvokedEvent(event)) {
      return `[Skill] ${event.skillName}\n`;
    } else if (isMessageEvent(event)) {
      return event.content;
    }
    return null;
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
  protected convertRequestToRawPrompt(request: ChatCompletionRequest): string {
    // Convert to prompt using prompts instance
    return this.prompts.functionCallHistoryToPrompt(request.messages);
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

}
