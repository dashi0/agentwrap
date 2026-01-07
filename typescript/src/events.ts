/**
 * Event types and structures for agent execution.
 *
 * This module defines all event types emitted by agents during execution,
 * mirroring the Python implementation for API consistency.
 */

/**
 * Enum of all possible event types.
 */
export enum EventType {
  THREAD_STARTED = 'thread_started',
  TURN_STARTED = 'turn_started',
  REASONING = 'reasoning',
  COMMAND_EXECUTION = 'command_execution',
  SKILL_INVOKED = 'skill_invoked',
  MESSAGE = 'message',
  TURN_COMPLETED = 'turn_completed',
  ERROR = 'error',
}

/**
 * Base interface for all events.
 */
export interface BaseEvent {
  type: EventType;
  metadata?: Record<string, unknown>;
}

/**
 * Event emitted when a new thread is started.
 */
export interface ThreadStartedEvent extends BaseEvent {
  type: EventType.THREAD_STARTED;
  threadId: string;
}

/**
 * Event emitted when a new turn begins.
 */
export interface TurnStartedEvent extends BaseEvent {
  type: EventType.TURN_STARTED;
}

/**
 * Event emitted when agent produces reasoning text.
 */
export interface ReasoningEvent extends BaseEvent {
  type: EventType.REASONING;
  content: string;
}

/**
 * Event emitted when agent executes a command.
 */
export interface CommandExecutionEvent extends BaseEvent {
  type: EventType.COMMAND_EXECUTION;
  command: string;
  output: string;
  exitCode?: number;
}

/**
 * Event emitted when a skill is invoked.
 */
export interface SkillInvokedEvent extends BaseEvent {
  type: EventType.SKILL_INVOKED;
  skillName: string;
}

/**
 * Event emitted when agent produces a message.
 */
export interface MessageEvent extends BaseEvent {
  type: EventType.MESSAGE;
  content: string;
}

/**
 * Usage statistics for a turn.
 */
export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

/**
 * Event emitted when a turn is completed.
 */
export interface TurnCompletedEvent extends BaseEvent {
  type: EventType.TURN_COMPLETED;
  usage?: UsageStats;
}

/**
 * Event emitted when an error occurs.
 */
export interface ErrorEvent extends BaseEvent {
  type: EventType.ERROR;
  content: string;
}

/**
 * Union type of all possible events.
 */
export type Event =
  | ThreadStartedEvent
  | TurnStartedEvent
  | ReasoningEvent
  | CommandExecutionEvent
  | SkillInvokedEvent
  | MessageEvent
  | TurnCompletedEvent
  | ErrorEvent;

/**
 * Type guard to check if an event is a ThreadStartedEvent.
 */
export function isThreadStartedEvent(event: Event): event is ThreadStartedEvent {
  return event.type === EventType.THREAD_STARTED;
}

/**
 * Type guard to check if an event is a MessageEvent.
 */
export function isMessageEvent(event: Event): event is MessageEvent {
  return event.type === EventType.MESSAGE;
}

/**
 * Type guard to check if an event is a ReasoningEvent.
 */
export function isReasoningEvent(event: Event): event is ReasoningEvent {
  return event.type === EventType.REASONING;
}

/**
 * Type guard to check if an event is a CommandExecutionEvent.
 */
export function isCommandExecutionEvent(event: Event): event is CommandExecutionEvent {
  return event.type === EventType.COMMAND_EXECUTION;
}

/**
 * Type guard to check if an event is a SkillInvokedEvent.
 */
export function isSkillInvokedEvent(event: Event): event is SkillInvokedEvent {
  return event.type === EventType.SKILL_INVOKED;
}

/**
 * Type guard to check if an event is a TurnCompletedEvent.
 */
export function isTurnCompletedEvent(event: Event): event is TurnCompletedEvent {
  return event.type === EventType.TURN_COMPLETED;
}

/**
 * Type guard to check if an event is an ErrorEvent.
 */
export function isErrorEvent(event: Event): event is ErrorEvent {
  return event.type === EventType.ERROR;
}
