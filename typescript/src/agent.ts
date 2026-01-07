/**
 * Base agent interface and structured output utilities.
 *
 * This module defines the abstract BaseAgent class and utilities for
 * structured JSON output, mirroring the Python implementation.
 */

import type { Event } from './events.js';
import { isMessageEvent } from './events.js';
import type { AgentInput, AllAgentConfigs } from './config.js';

// ============================================================================
// Structured Output Utilities
// ============================================================================

/**
 * JSON schema interface (simplified).
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Extract JSON from text using multiple strategies.
 */
export class JSONExtractor {
  /**
   * Try multiple strategies to extract JSON from text.
   */
  static extract(text: string): unknown | null {
    // Strategy 1: Direct parse
    try {
      return JSON.parse(text.trim()) as unknown;
    } catch {
      // Continue to next strategy
    }

    // Strategy 2: Extract from markdown code block
    const patterns = [/```json\s*\n(.*?)\n```/s, /```\s*\n(.*?)\n```/s];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        try {
          return JSON.parse(match[1]) as unknown;
        } catch {
          continue;
        }
      }
    }

    // Strategy 3: Find JSON-like structure in text
    const bracePatterns = [
      /\{[^}]*\}/g, // Simple object
      /\{.*?\}/gs, // Object (non-greedy)
      /\[.*?\]/gs, // Array (non-greedy)
    ];

    for (const pattern of bracePatterns) {
      const matches = Array.from(text.matchAll(pattern));
      // Try longest matches first
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i]?.[0];
        if (!match) continue;

        try {
          const result = JSON.parse(match) as unknown;
          if (typeof result === 'object' && result !== null) {
            return result;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Validate JSON data against schema (basic validation).
   */
  static validateSchema(data: unknown, schema: JSONSchema): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Data must be an object');
    }

    const dataObj = data as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in dataObj)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }

    // Note: This is a simplified validation.
    // For production, use a library like ajv or zod.
  }
}

/**
 * Parser for structured output with schema validation.
 */
export class StructuredOutputParser {
  constructor(private schema: JSONSchema) {}

  /**
   * Parse agent output and validate against schema.
   */
  parse(agentOutput: string): unknown {
    // Extract JSON
    const data = JSONExtractor.extract(agentOutput);

    if (data === null) {
      throw new Error(
        'Failed to extract JSON from agent output. ' + 'Output should contain valid JSON structure.'
      );
    }

    // Validate against schema
    try {
      JSONExtractor.validateSchema(data, this.schema);
    } catch (error) {
      throw new Error(`Validation failed: ${(error as Error).message}`);
    }

    return data;
  }
}

/**
 * Create a prompt that encourages structured JSON output.
 */
export function createStructuredPrompt(
  query: string,
  schema: JSONSchema,
  examples?: unknown[]
): string {
  const parts: string[] = [query];

  parts.push('\n\nIMPORTANT: You MUST respond with valid JSON matching this schema:');
  parts.push('```json\n' + JSON.stringify(schema, null, 2) + '\n```');

  if (examples && examples.length > 0) {
    parts.push('\n\nExamples of valid output:');
    examples.forEach((example, i) => {
      parts.push(`\nExample ${i + 1}:`);
      parts.push('```json\n' + JSON.stringify(example, null, 2) + '\n```');
    });
  }

  parts.push('\n\nRespond with ONLY the JSON, no additional text.');

  return parts.join('');
}

// ============================================================================
// Base Agent
// ============================================================================

/**
 * Abstract base class for all agent implementations.
 */
export abstract class BaseAgent {
  protected config?: AllAgentConfigs;

  /**
   * Get current agent configuration.
   */
  getConfig(): AllAgentConfigs | undefined {
    return this.config;
  }

  /**
   * Normalize input to AgentInput format.
   * Accepts either AgentInput object or a simple string query.
   */
  protected normalizeInput(input: AgentInput | string): AgentInput {
    if (typeof input === 'string') {
      return {
        messages: [{ role: 'user', content: input }],
      };
    }
    return input;
  }

  /**
   * Execute agent with streaming output.
   *
   * Accepts either an AgentInput object or a simple string query.
   * If a string is provided, it will be automatically converted to AgentInput.
   *
   * Subclasses must implement this method.
   */
  abstract run(
    agentInput: AgentInput | string,
    configOverrides?: Partial<AllAgentConfigs>
  ): AsyncIterable<Event>;

  /**
   * Execute agent and ensure structured JSON output.
   *
   * This method retries on parsing failures with more explicit instructions.
   */
  async runStructured(
    agentInput: AgentInput | string,
    schema: JSONSchema,
    options: {
      examples?: unknown[];
      maxRetries?: number;
      configOverrides?: Partial<AllAgentConfigs>;
    } = {}
  ): Promise<unknown> {
    const { examples, maxRetries = 3, configOverrides } = options;
    const parser = new StructuredOutputParser(schema);

    // Normalize input
    const normalizedInput = this.normalizeInput(agentInput);

    // Get the user query from messages
    const lastMessage = normalizedInput.messages[normalizedInput.messages.length - 1];
    if (!lastMessage) {
      throw new Error('AgentInput must have at least one message');
    }

    const structuredQuery = createStructuredPrompt(lastMessage.content, schema, examples);

    // Create new input with structured prompt
    let structuredMessages = [
      ...normalizedInput.messages.slice(0, -1),
      { ...lastMessage, content: structuredQuery },
    ];

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Collect agent messages
        const messages: string[] = [];

        for await (const event of this.run({ ...normalizedInput, messages: structuredMessages }, configOverrides)) {
          if (isMessageEvent(event)) {
            messages.push(event.content);
          }
        }

        const fullOutput = messages.join('\n\n');
        const result = parser.parse(fullOutput);
        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries - 1) {
          // Retry with more explicit instructions
          const retryQuery =
            `${lastMessage.content}\n\nPrevious attempt failed: ${lastError.message}\n` +
            'Please ensure you output VALID JSON.';

          structuredMessages = [
            ...normalizedInput.messages.slice(0, -1),
            { ...lastMessage, content: createStructuredPrompt(retryQuery, schema, examples) },
          ];
        }
      }
    }

    throw new Error(
      `Failed to get valid structured output after ${maxRetries} attempts. ` +
        `Last error: ${lastError?.message ?? 'Unknown error'}`
    );
  }
}
