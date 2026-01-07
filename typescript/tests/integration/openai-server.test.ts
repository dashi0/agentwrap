/**
 * Integration Test: OpenAI-Compatible Server with Function Calling
 *
 * Tests the complete function calling flow:
 * 1. Agent returns first function call
 * 2. Agent returns second dependent function call
 * 3. Agent returns final summary
 *
 * Requires OPENAI_API_KEY and codex-cli to be available.
 *
 * Note: This test uses OpenAICompatibleServer directly (no HTTP server needed).
 * The dynamic MCP bridge still runs on localhost in the background.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CodexAgent } from '../../src/agents/codexAgent.js';
import { OpenAICompatibleServer } from '../../src/servers/openaiCompatible.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionMessage,
} from '../../src/server/types.js';

// Skip tests if API key is not available
const skipIntegration = !process.env.OPENAI_API_KEY;
const TEST_API_KEY = process.env.OPENAI_API_KEY || '';

describe.skipIf(skipIntegration)('OpenAI-Compatible Server Integration', () => {
  // Create agent and server once for all tests
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

  /**
   * Helper: Process chat completion request directly (no HTTP server)
   */
  async function callChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await server.handleRequest(request);
    // Response is always returned (never void) since API change
    expect(response).toBeDefined();
    expect(response.id).toBeTruthy();
    expect(response.object).toBe('chat.completion');
    return response;
  }

  /**
   * Test Case 1, 2, 3: Complete function calling flow
   */
  it(
    'should handle sequential function calls (getUserId → getProfile → summary)',
    async () => {
      // Define two functions: getUserId and getProfile
      // getProfile depends on getUserId's output
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'getUserId',
            description: 'Get the user ID for a given username',
            parameters: {
              type: 'object' as const,
              properties: {
                username: {
                  type: 'string',
                  description: 'The username to look up',
                },
              },
              required: ['username'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'getProfile',
            description: 'Get the user profile given a user ID',
            parameters: {
              type: 'object' as const,
              properties: {
                userId: {
                  type: 'string',
                  description: 'The user ID',
                },
              },
              required: ['userId'],
            },
          },
        },
      ];

      // ========================================================================
      // Case 1: Server returns first function call (getUserId)
      // ========================================================================
      console.log('\n=== Case 1: First function call ===');

      const turn1Request: ChatCompletionRequest = {
        model: 'agentwrap-codex',
        messages: [
          {
            role: 'user',
            content: `You have access to two functions: getUserId and getProfile.

IMPORTANT: You MUST call these functions, do NOT simulate or fake the function calls. You MUST actually invoke the tools.

Task: Get the profile for user 'alice' by:
1. First call getUserId with username='alice'
2. Wait for the result
3. Then call getProfile with the userId from step 1

Start by calling the first function now.`,
          },
        ],
        tools,
      };

      console.log('Turn 1 Request:', JSON.stringify(turn1Request, null, 2));

      const turn1Response = await callChatCompletion(turn1Request);
      console.log('Turn 1 Response:', JSON.stringify(turn1Response, null, 2));

      // Verify: Should have tool calls
      expect(turn1Response.choices).toHaveLength(1);
      const turn1Choice = turn1Response.choices[0];
      expect(turn1Choice).toBeDefined();
      expect(turn1Choice!.message.tool_calls).toBeDefined();
      expect(turn1Choice!.message.tool_calls!.length).toBeGreaterThan(0);

      // Verify: Should call getUserId first
      const firstToolCall = turn1Choice!.message.tool_calls![0];
      expect(firstToolCall).toBeDefined();
      expect(firstToolCall!.function.name).toBe('getUserId');

      const getUserIdArgs = JSON.parse(firstToolCall!.function.arguments);
      expect(getUserIdArgs.username).toBe('alice');

      console.log(`✓ Case 1 passed: Server returned function call ${firstToolCall!.function.name}`);

      // ========================================================================
      // Case 2: Execute getUserId and server returns second function call (getProfile)
      // ========================================================================
      console.log('\n=== Case 2: Second function call ===');

      // Simulate executing getUserId
      const userId = 'user_12345';
      const getUserIdResult = JSON.stringify({ userId });

      const turn2Messages: ChatCompletionMessage[] = [
        ...turn1Request.messages,
        turn1Choice!.message,
        {
          role: 'tool',
          content: getUserIdResult,
          tool_call_id: firstToolCall!.id,
        },
      ];

      const turn2Request: ChatCompletionRequest = {
        model: 'agentwrap-codex',
        messages: turn2Messages,
        tools,
      };

      console.log('Turn 2 Request:', JSON.stringify(turn2Request, null, 2));

      const turn2Response = await callChatCompletion(turn2Request);
      console.log('Turn 2 Response:', JSON.stringify(turn2Response, null, 2));

      // Verify: Should have tool calls
      expect(turn2Response.choices).toHaveLength(1);
      const turn2Choice = turn2Response.choices[0];
      expect(turn2Choice).toBeDefined();
      expect(turn2Choice!.message.tool_calls).toBeDefined();
      expect(turn2Choice!.message.tool_calls!.length).toBeGreaterThan(0);

      // Verify: Should call getProfile with userId from getUserId
      const secondToolCall = turn2Choice!.message.tool_calls![0];
      expect(secondToolCall).toBeDefined();
      expect(secondToolCall!.function.name).toBe('getProfile');

      const getProfileArgs = JSON.parse(secondToolCall!.function.arguments);
      expect(getProfileArgs.userId).toBe(userId);

      console.log(`✓ Case 2 passed: Server returned function call ${secondToolCall!.function.name} with userId=${userId}`);

      // ========================================================================
      // Case 3: Execute getProfile and server returns final summary
      // ========================================================================
      console.log('\n=== Case 3: Final summary ===');

      // Simulate executing getProfile
      const profile = {
        userId,
        name: 'Alice Smith',
        email: 'alice@example.com',
        role: 'Engineer',
      };
      const getProfileResult = JSON.stringify(profile);

      const turn3Messages: ChatCompletionMessage[] = [
        ...turn2Messages,
        turn2Choice!.message,
        {
          role: 'tool',
          content: getProfileResult,
          tool_call_id: secondToolCall!.id,
        },
      ];

      const turn3Request: ChatCompletionRequest = {
        model: 'agentwrap-codex',
        messages: turn3Messages,
        tools,
      };

      console.log('Turn 3 Request:', JSON.stringify(turn3Request, null, 2));

      const turn3Response = await callChatCompletion(turn3Request);
      console.log('Turn 3 Response:', JSON.stringify(turn3Response, null, 2));

      // Verify: Should NOT have tool calls (final response)
      expect(turn3Response.choices).toHaveLength(1);
      const turn3Choice = turn3Response.choices[0];
      expect(turn3Choice).toBeDefined();
      expect(turn3Choice!.message.content).toBeTruthy();
      expect(turn3Choice!.finish_reason).toBe('stop');

      // Verify: Response should mention user info
      const finalContent = turn3Choice!.message.content!.toLowerCase();
      expect(finalContent).toContain('alice');

      console.log(`✓ Case 3 passed: Server returned final summary without function calls`);
      console.log(`Final response: ${turn3Choice!.message.content}`);
    },
    120000 // 2 minute timeout for full flow
  );
});
