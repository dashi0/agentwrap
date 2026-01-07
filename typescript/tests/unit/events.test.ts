/**
 * Unit tests for event types and type guards.
 */

import { describe, it, expect } from 'vitest';
import {
  EventType,
  isThreadStartedEvent,
  isMessageEvent,
  isReasoningEvent,
  isCommandExecutionEvent,
  isSkillInvokedEvent,
  isTurnCompletedEvent,
  isErrorEvent,
  type ThreadStartedEvent,
  type MessageEvent,
  type ReasoningEvent,
  type CommandExecutionEvent,
  type SkillInvokedEvent,
  type TurnCompletedEvent,
  type ErrorEvent,
} from '../../src/events.js';

describe('Events', () => {
  describe('EventType enum', () => {
    it('should have all event types', () => {
      expect(EventType.THREAD_STARTED).toBe('thread_started');
      expect(EventType.TURN_STARTED).toBe('turn_started');
      expect(EventType.REASONING).toBe('reasoning');
      expect(EventType.COMMAND_EXECUTION).toBe('command_execution');
      expect(EventType.SKILL_INVOKED).toBe('skill_invoked');
      expect(EventType.MESSAGE).toBe('message');
      expect(EventType.TURN_COMPLETED).toBe('turn_completed');
      expect(EventType.ERROR).toBe('error');
    });
  });

  describe('Type guards', () => {
    it('should correctly identify ThreadStartedEvent', () => {
      const event: ThreadStartedEvent = {
        type: EventType.THREAD_STARTED,
        threadId: 'thread-123',
      };

      expect(isThreadStartedEvent(event)).toBe(true);
      expect(isMessageEvent(event)).toBe(false);
    });

    it('should correctly identify MessageEvent', () => {
      const event: MessageEvent = {
        type: EventType.MESSAGE,
        content: 'Hello world',
      };

      expect(isMessageEvent(event)).toBe(true);
      expect(isReasoningEvent(event)).toBe(false);
    });

    it('should correctly identify ReasoningEvent', () => {
      const event: ReasoningEvent = {
        type: EventType.REASONING,
        content: 'Thinking...',
      };

      expect(isReasoningEvent(event)).toBe(true);
      expect(isCommandExecutionEvent(event)).toBe(false);
    });

    it('should correctly identify CommandExecutionEvent', () => {
      const event: CommandExecutionEvent = {
        type: EventType.COMMAND_EXECUTION,
        command: 'ls -la',
        output: 'file1.txt\nfile2.txt',
        exitCode: 0,
      };

      expect(isCommandExecutionEvent(event)).toBe(true);
      expect(isSkillInvokedEvent(event)).toBe(false);
    });

    it('should correctly identify SkillInvokedEvent', () => {
      const event: SkillInvokedEvent = {
        type: EventType.SKILL_INVOKED,
        skillName: 'echo-skill',
      };

      expect(isSkillInvokedEvent(event)).toBe(true);
      expect(isTurnCompletedEvent(event)).toBe(false);
    });

    it('should correctly identify TurnCompletedEvent', () => {
      const event: TurnCompletedEvent = {
        type: EventType.TURN_COMPLETED,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      };

      expect(isTurnCompletedEvent(event)).toBe(true);
      expect(isErrorEvent(event)).toBe(false);
    });

    it('should correctly identify ErrorEvent', () => {
      const event: ErrorEvent = {
        type: EventType.ERROR,
        content: 'Something went wrong',
      };

      expect(isErrorEvent(event)).toBe(true);
      expect(isThreadStartedEvent(event)).toBe(false);
    });
  });

  describe('Event metadata', () => {
    it('should allow optional metadata', () => {
      const event: MessageEvent = {
        type: EventType.MESSAGE,
        content: 'Test',
        metadata: {
          timestamp: Date.now(),
          source: 'test',
        },
      };

      expect(event.metadata).toBeDefined();
      expect(event.metadata?.timestamp).toBeTypeOf('number');
    });
  });
});
