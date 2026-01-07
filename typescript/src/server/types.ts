/**
 * OpenAI Chat Completion API types.
 *
 * These types mirror the OpenAI API for compatibility with existing clients.
 */

export interface ChatCompletionFunctionParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ChatCompletionFunction {
  name: string;
  description?: string;
  parameters: ChatCompletionFunctionParameters;
}

export interface ChatCompletionTool {
  type: 'function';
  function: ChatCompletionFunction;
}

export interface ChatCompletionFunctionCall {
  name: string;
  arguments: string; // JSON string
}

export interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: ChatCompletionFunctionCall;
}

export interface ChatCompletionMessageBase {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  name?: string;
}

export interface ChatCompletionUserMessage extends ChatCompletionMessageBase {
  role: 'user';
  content: string;
}

export interface ChatCompletionAssistantMessage extends ChatCompletionMessageBase {
  role: 'assistant';
  content: string | null;
  tool_calls?: ChatCompletionToolCall[];
  function_call?: ChatCompletionFunctionCall; // Legacy
}

export interface ChatCompletionToolMessage extends ChatCompletionMessageBase {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

export interface ChatCompletionFunctionMessage extends ChatCompletionMessageBase {
  role: 'function';
  content: string;
  name: string; // Function name
}

export type ChatCompletionMessage =
  | ChatCompletionUserMessage
  | ChatCompletionAssistantMessage
  | ChatCompletionToolMessage
  | ChatCompletionFunctionMessage;

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  // Function calling (new format)
  tools?: ChatCompletionTool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  // Function calling (legacy format)
  functions?: ChatCompletionFunction[];
  function_call?: 'none' | 'auto' | { name: string };
  // Streaming
  stream?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionAssistantMessage;
  finish_reason: 'stop' | 'tool_calls' | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
}

// Streaming response types
export interface ChatCompletionChunkDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: 'stop' | 'tool_calls' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// Error response
export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}
