/**
 * Integration Test: OpenAI Streaming
 *
 * Tests the streaming functionality where agent events are streamed
 * as reasoning/thinking process (like OpenAI o1 model).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CodexAgent } from '../../src/agents/codexAgent.js';
import { OpenAICompatibleServer } from '../../src/servers/openaiCompatible.js';
import type { ChatCompletionRequest, ChatCompletionChunk } from '../../src/server/types.js';

// Skip tests if API key is not available
const skipIntegration = !process.env.OPENAI_API_KEY;
const TEST_API_KEY = process.env.OPENAI_API_KEY || '';

describe.skipIf(skipIntegration)('OpenAI Streaming Integration', () => {
  const agent = new CodexAgent();
  const server = new OpenAICompatibleServer(agent);

  beforeAll(async () => {
    // Configure agent with API key
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
      },
      skills: [],
    });
  });

  it(
    'should return ChatCompletionResponse for in-process streaming request',
    async () => {
      // Test streaming request without res (in-process usage)
      const request: ChatCompletionRequest = {
        model: 'agentwrap-codex',
        messages: [
          {
            role: 'user',
            content: 'What is 2+2?',
          },
        ],
        stream: true, // Even with stream=true, should return response
      };

      // Call handleRequest directly without res parameter
      const response = await server.handleRequest(request);

      // Verify response is returned (not void)
      expect(response).toBeDefined();
      expect(response.id).toBeTruthy();
      expect(response.object).toBe('chat.completion');
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.role).toBe('assistant');
      expect(response.choices[0].message.content).toBeTruthy();
      expect(response.choices[0].finish_reason).toBe('stop');

      console.log('\n✓ In-process streaming returned response:', response.choices[0].message.content?.substring(0, 100));
    },
    120000 // 2 minute timeout
  );

  it(
    'should stream agent events as SSE chunks',
    async () => {
      // Start HTTP server
      await server.startHttpServer({ port: 3101, host: '127.0.0.1' });

      try {
        // Make streaming request
        const request: ChatCompletionRequest = {
          model: 'agentwrap-codex',
          messages: [
            {
              role: 'user',
              content: 'What is 2+2? Please think step by step.',
            },
          ],
          stream: true,
        };

        // Use fetch to test streaming
        const response = await fetch('http://127.0.0.1:3101/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });

        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toBe('text/event-stream');

        // Collect chunks
        const chunks: ChatCompletionChunk[] = [];
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                break;
              }
              try {
                const chunk = JSON.parse(data) as ChatCompletionChunk;
                chunks.push(chunk);
              } catch (e) {
                // Ignore parse errors
              }
            }
          }

          if (buffer.includes('[DONE]')) break;
        }

        // Verify chunks
        expect(chunks.length).toBeGreaterThan(0);

        // First chunk should have role
        expect(chunks[0].choices[0].delta.role).toBe('assistant');

        // Should have content chunks
        const contentChunks = chunks.filter((c) => c.choices[0].delta.content);
        expect(contentChunks.length).toBeGreaterThan(0);

        // Last chunk should have finish_reason
        const lastChunk = chunks[chunks.length - 1];
        expect(lastChunk.choices[0].finish_reason).toBe('stop');

        // Collect all content
        const fullContent = chunks
          .map((c) => c.choices[0].delta.content || '')
          .join('');

        console.log(`\nStreamed content (${chunks.length} chunks):`);
        console.log(fullContent.substring(0, 500)); // First 500 chars

        expect(fullContent.length).toBeGreaterThan(0);
      } finally {
        // Stop server
        await server.stopHttpServer();
      }
    },
    120000 // 2 minute timeout
  );
});
