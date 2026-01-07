/**
 * AgentWrap TypeScript SDK
 *
 * Agent-First AI Framework - Let AI make decisions, not code.
 */

// Core agent interfaces
export {
  BaseAgent,
  JSONExtractor,
  StructuredOutputParser,
  createStructuredPrompt,
  type RunOptions,
  type RunStructuredOptions,
} from './agent.js';

// Prompts management
export { Prompts } from './prompts.js';

// Agent implementations
export { CodexAgent } from './agents/codexAgent.js';

// Server interfaces
export {
  BaseServer,
  type HttpServerOptions,
  type FunctionCallingOptions,
  type ToolCall,
} from './server.js';

// Server implementations
export {
  OpenAICompatibleServer,
  type OpenAIServerOptions,
} from './servers/openaiCompatible.js';

// Configuration
export type {
  MCPStdioSkillConfig,
  MCPSSESkillConfig,
  MCPSkillConfig,
  AnthropicSkillConfig,
  SkillConfig,
  CodexAgentConfig,
  AgentConfigType,
  AllAgentConfigs,
  Message,
} from './config.js';

export {
  parseConfig,
  mergeConfigs,
  printConfigSummary,
} from './config.js';

export type { AgentInput } from './config.js';

// Events
export type {
  BaseEvent,
  ThreadStartedEvent,
  TurnStartedEvent,
  ReasoningEvent,
  CommandExecutionEvent,
  SkillInvokedEvent,
  MessageEvent,
  TurnCompletedEvent,
  ErrorEvent,
  Event,
  UsageStats,
} from './events.js';

export {
  EventType,
  isThreadStartedEvent,
  isMessageEvent,
  isReasoningEvent,
  isCommandExecutionEvent,
  isSkillInvokedEvent,
  isTurnCompletedEvent,
  isErrorEvent,
} from './events.js';

// OpenAI API Types
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessage,
  ChatCompletionFunction,
  ChatCompletionTool,
  ChatCompletionToolCall,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ErrorResponse,
} from './server/types.js';
