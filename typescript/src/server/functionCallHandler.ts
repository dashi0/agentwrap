/**
 * Function Call Handler
 *
 * Manages the lifecycle of function calls between the user process,
 * agentwrap server, and codex agent.
 */

import type {
  ChatCompletionMessage,
  ChatCompletionAssistantMessage,
  ChatCompletionToolMessage,
  ChatCompletionToolCall,
} from './types.js';

/**
 * Convert function call history to a prompt that can be understood by the agent.
 *
 * This is used when continuing a conversation after function calls have been executed.
 */
export function convertFunctionCallHistoryToPrompt(messages: ChatCompletionMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      parts.push(`User: ${message.content}`);
    } else if (message.role === 'assistant') {
      if (message.content) {
        parts.push(`Assistant: ${message.content}`);
      }

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          parts.push(
            `Assistant called function: ${toolCall.function.name}\n` +
              `Arguments: ${JSON.stringify(args, null, 2)}`
          );
        }
      }

      // Legacy function call support
      if (message.function_call) {
        const args = JSON.parse(message.function_call.arguments);
        parts.push(
          `Assistant called function: ${message.function_call.name}\n` +
            `Arguments: ${JSON.stringify(args, null, 2)}`
        );
      }
    } else if (message.role === 'tool') {
      const toolMsg = message as ChatCompletionToolMessage;
      parts.push(`Function result (${toolMsg.tool_call_id}): ${toolMsg.content}`);
    } else if (message.role === 'function') {
      parts.push(`Function ${message.name} result: ${message.content}`);
    } else if (message.role === 'system') {
      parts.push(`System: ${message.content}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Check if messages contain function call results that need to be processed.
 */
export function hasFunctionResults(messages: ChatCompletionMessage[]): boolean {
  return messages.some((msg) => msg.role === 'tool' || msg.role === 'function');
}

/**
 * Find the last assistant message with tool calls.
 */
export function findLastToolCallMessage(
  messages: ChatCompletionMessage[]
): ChatCompletionAssistantMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'assistant' && (msg.tool_calls || msg.function_call)) {
      return msg as ChatCompletionAssistantMessage;
    }
  }
  return null;
}

/**
 * Extract function definitions from messages (for context).
 */
export interface FunctionContext {
  name: string;
  description?: string;
  called: boolean;
  arguments?: Record<string, unknown>;
  result?: string;
}

export function extractFunctionContext(messages: ChatCompletionMessage[]): FunctionContext[] {
  const functions = new Map<string, FunctionContext>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      // Handle tool calls
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          functions.set(toolCall.function.name, {
            name: toolCall.function.name,
            called: true,
            arguments: JSON.parse(toolCall.function.arguments),
          });
        }
      }

      // Legacy function call
      if (message.function_call) {
        functions.set(message.function_call.name, {
          name: message.function_call.name,
          called: true,
          arguments: JSON.parse(message.function_call.arguments),
        });
      }
    } else if (message.role === 'tool') {
      const toolMsg = message as ChatCompletionToolMessage;
      // Find the function name from previous assistant message
      const lastCall = findLastToolCallMessage(messages);
      if (lastCall?.tool_calls) {
        const call = lastCall.tool_calls.find((tc) => tc.id === toolMsg.tool_call_id);
        if (call) {
          const existing = functions.get(call.function.name);
          if (existing) {
            existing.result = toolMsg.content;
          }
        }
      }
    } else if (message.role === 'function') {
      const existing = functions.get(message.name!);
      if (existing) {
        existing.result = message.content || undefined;
      }
    }
  }

  return Array.from(functions.values());
}

/**
 * Create a system prompt that explains the function call results.
 */
export function createFunctionResultPrompt(messages: ChatCompletionMessage[]): string {
  const context = extractFunctionContext(messages);

  if (context.length === 0) {
    return '';
  }

  const parts = [
    'Previous function calls in this conversation:',
    '',
  ];

  for (const fn of context) {
    parts.push(`Function: ${fn.name}`);
    if (fn.arguments) {
      parts.push(`  Arguments: ${JSON.stringify(fn.arguments, null, 2)}`);
    }
    if (fn.result !== undefined) {
      parts.push(`  Result: ${fn.result}`);
    }
    parts.push('');
  }

  parts.push('Please continue the conversation taking these function results into account.');

  return parts.join('\n');
}

/**
 * Merge function call results into the message history for the next turn.
 */
export function mergeFunctionResults(
  messages: ChatCompletionMessage[]
): ChatCompletionMessage[] {
  // If there are function results, add a system message summarizing them
  if (hasFunctionResults(messages)) {
    const resultPrompt = createFunctionResultPrompt(messages);

    // Insert system message after the last function result
    const lastFunctionIdx = messages.reduce(
      (lastIdx, msg, idx) => (msg.role === 'tool' || msg.role === 'function' ? idx : lastIdx),
      -1
    );

    if (lastFunctionIdx >= 0 && resultPrompt) {
      const newMessages = [...messages];
      newMessages.splice(lastFunctionIdx + 1, 0, {
        role: 'system',
        content: resultPrompt,
      });
      return newMessages;
    }
  }

  return messages;
}
