/**
 * Unit tests for structured output utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  JSONExtractor,
  StructuredOutputParser,
  createStructuredPrompt,
  type JSONSchema,
} from '../../src/agent.js';

describe('Structured Output', () => {
  describe('JSONExtractor', () => {
    describe('extract', () => {
      it('should extract direct JSON', () => {
        const text = '{"name": "John", "age": 30}';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should extract JSON from markdown code block with json tag', () => {
        const text = '```json\n{"name": "John", "age": 30}\n```';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should extract JSON from markdown code block without json tag', () => {
        const text = '```\n{"name": "John", "age": 30}\n```';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should extract JSON embedded in text', () => {
        const text = 'Here is the data: {"name": "John", "age": 30} as requested.';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should extract JSON array', () => {
        const text = '[1, 2, 3, 4, 5]';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual([1, 2, 3, 4, 5]);
      });

      it('should return null for invalid JSON', () => {
        const text = 'This is just plain text with no JSON';
        const result = JSONExtractor.extract(text);

        expect(result).toBeNull();
      });

      it('should handle nested JSON', () => {
        const text = '```json\n{"user": {"name": "John", "details": {"age": 30}}}\n```';
        const result = JSONExtractor.extract(text);

        expect(result).toEqual({
          user: {
            name: 'John',
            details: { age: 30 },
          },
        });
      });
    });

    describe('validateSchema', () => {
      it('should validate object with required fields', () => {
        const data = { name: 'John', age: 30 };
        const schema: JSONSchema = {
          type: 'object',
          required: ['name', 'age'],
        };

        expect(() => JSONExtractor.validateSchema(data, schema)).not.toThrow();
      });

      it('should throw error for missing required field', () => {
        const data = { name: 'John' };
        const schema: JSONSchema = {
          type: 'object',
          required: ['name', 'age'],
        };

        expect(() => JSONExtractor.validateSchema(data, schema)).toThrow('Missing required field');
      });

      it('should throw error for non-object data', () => {
        const data = 'not an object';
        const schema: JSONSchema = {
          type: 'object',
          required: ['name'],
        };

        expect(() => JSONExtractor.validateSchema(data, schema)).toThrow('Data must be an object');
      });

      it('should validate when no required fields', () => {
        const data = { name: 'John' };
        const schema: JSONSchema = {
          type: 'object',
        };

        expect(() => JSONExtractor.validateSchema(data, schema)).not.toThrow();
      });
    });
  });

  describe('StructuredOutputParser', () => {
    it('should parse valid JSON and validate', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const parser = new StructuredOutputParser(schema);
      const output = '{"name": "John", "age": 30}';

      const result = parser.parse(output);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should parse JSON from markdown', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['status'],
      };

      const parser = new StructuredOutputParser(schema);
      const output = '```json\n{"status": "success"}\n```';

      const result = parser.parse(output);

      expect(result).toEqual({ status: 'success' });
    });

    it('should throw error when JSON extraction fails', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['name'],
      };

      const parser = new StructuredOutputParser(schema);
      const output = 'No JSON here';

      expect(() => parser.parse(output)).toThrow('Failed to extract JSON');
    });

    it('should throw error when validation fails', () => {
      const schema: JSONSchema = {
        type: 'object',
        required: ['name', 'age'],
      };

      const parser = new StructuredOutputParser(schema);
      const output = '{"name": "John"}'; // Missing 'age'

      expect(() => parser.parse(output)).toThrow('Validation failed');
    });
  });

  describe('createStructuredPrompt', () => {
    it('should create prompt with schema', () => {
      const query = 'Extract user info';
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const prompt = createStructuredPrompt(query, schema);

      expect(prompt).toContain('Extract user info');
      expect(prompt).toContain('IMPORTANT: You MUST respond with valid JSON');
      expect(prompt).toContain(JSON.stringify(schema, null, 2));
      expect(prompt).toContain('Respond with ONLY the JSON');
    });

    it('should include examples when provided', () => {
      const query = 'Extract user info';
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };
      const examples = [{ name: 'John' }, { name: 'Jane' }];

      const prompt = createStructuredPrompt(query, schema, examples);

      expect(prompt).toContain('Examples of valid output');
      expect(prompt).toContain('Example 1');
      expect(prompt).toContain('Example 2');
      expect(prompt).toContain(JSON.stringify(examples[0], null, 2));
      expect(prompt).toContain(JSON.stringify(examples[1], null, 2));
    });

    it('should not include examples section when not provided', () => {
      const query = 'Extract user info';
      const schema: JSONSchema = {
        type: 'object',
        required: ['name'],
      };

      const prompt = createStructuredPrompt(query, schema);

      expect(prompt).not.toContain('Examples of valid output');
    });
  });
});
