/**
 * Prompts - Centralized prompt management
 *
 * All prompt assembly logic is consolidated here, allowing users to
 * customize prompts by extending this class or providing a custom instance.
 */

import type { Message } from './config.js';
import type {
  ChatCompletionMessage,
  ChatCompletionFunction,
} from './server/types.js';

/**
 * Prompts class handles all prompt assembly in the library.
 * Users can extend this class to customize prompts.
 */
export class Prompts {
  public static readonly USER_DEFINED_FUNCTIONS_MCP_NAME = "userDefinedFunctions";
  private systemPrompt: string;
  constructor(systemPrompt?: string) {
    this.systemPrompt = systemPrompt || 'Understand the conversation below and respond appropriately. Follow any instructions given by the user.';
  }
  /**
   * Convert message array to prompt string.
   * Used when normalizing AgentInput from Message[].
   */
  messagesToPrompt(messages: Message[]): string {
    if (!messages || !messages.length) {
      throw new Error('No messages provided to convert to prompt.');
    }
    return `<SystemInstructions>
${this.systemPrompt}
</SystemInstructions>
<Conversation>
${messages.map((message) => `  <Message role="${message.role}">${message.content}</Message>`).join('\n')}
</Conversation>`;
  }

  /**
   * Create structured output prompt with JSON schema.
   * Used by runStructured() to enforce JSON response format.
   */
  structuredOutputPrompt(query: string, schema: object, previousAttempts: [string, Error][]): string {
    const parts = [query];


    parts.push(`
<OutputFormat>
IMPORTANT: You MUST respond with valid JSON matching this schema:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Respond with ONLY the JSON, no additional text.
</OutputFormat>
      `
    );
    if (previousAttempts.length > 0) {
      parts.push('\n\n<PreviousAttempts>\nPrevious attempts to provide valid JSON:\n');
      previousAttempts.forEach(([output, error], index) => {
        parts.push(`\nAttempt ${index + 1}:\n\`\`\`json\n${output}\n\`\`\`\nError: ${error.message}\n`);
      });
      parts.push('\nPlease correct the above errors and provide valid JSON this time.\n</PreviousAttempts>\n');
    }

    return parts.join('');
  }

  /**
   * Convert OpenAI ChatCompletion message history to prompt.
   * Used by OpenAI-compatible server to convert request messages to agent prompt.
   */
  functionCallHistoryToPrompt(messages: ChatCompletionMessage[]): string {
    return `<SystemInstructions>
${this.systemPrompt}
</SystemInstructions>
<Conversation>
${messages.map((message) => {
    if ((message.role === 'tool' || message.role === 'function') && 'tool_call_id' in message && message.tool_call_id) {
      return `  <Message role="${message.role}" tool_call_id="${message.tool_call_id}">${message.content}</Message>`;
    }
    // Handle new tool_calls format (OpenAI API 2023-11+)
    if ('tool_calls' in message && message.tool_calls && message.tool_calls.length > 0) {
      const toolCallsXml = message.tool_calls
        .map((tc) => `<ToolCall id="${tc.id}" type="${tc.type}" name="${tc.function.name}">${tc.function.arguments}</ToolCall>`)
        .join('\n    ');
      return `  <Message role="${message.role}">\n    ${toolCallsXml}\n  </Message>`;
    }
    // Handle legacy function_call format (deprecated)
    if ('function_call' in message && message.function_call) {
      return `  <Message role="${message.role}"><FunctionCall name="${message.function_call.name}">${JSON.stringify(message.function_call.arguments, null, 2)}</FunctionCall></Message>`;
    }
    return `  <Message role="${message.role}">${message.content}</Message>`
}).join('\n')}
</Conversation>

`;
  }



  /**
   * Prepend tool calling instructions to a prompt.
   * Used by BaseServer when handling requests with function definitions.
   *
   * @param originalPrompt - The base prompt
   * @param functions - List of available functions
   * @param prefix - Optional request ID prefix for function names (e.g., "abc123" for functions like "abc123_getUserId")
   */
  prependToolCallingInstructions(
    originalPrompt: string,
    functions: ChatCompletionFunction[],
    prefix?: string
  ): string {
    if (!functions?.length) {
      return originalPrompt;
    }
    const functionList = functions.map((f) => `- ${f.name}: ${f.description || 'No description'}`).join('\n');

    // Build the MCP tool pattern - if prefix is provided, use it to help agent identify the functions
    const mcpToolPattern = prefix
      ? `${Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME}.${prefix}_*`
      : `${Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME}.*`;

    return `${originalPrompt}
<ToolCallHints>
You have access to the following tools/functions:

${functionList}

DECISION PROCESS:
1. First, carefully read the user instructions and tool calling history in the <Conversation /> above.

    * Pay special attention to any <Message role="tool"/> or <Message role="function"/> entries, as they contain results from previous tool calls.
      The results you need may already be present - DO NOT call functions that have already been called with the same name/arguments

2. Decide whether you need to call any tools/functions OR provide a final response

IF YOU NEED TO CALL TOOLS:
- Invoke it directly using MCP tools ${mcpToolPattern}
- DO NOT write descriptive text like "I will call..." or "Waiting for..." - just call the function

IF YOU DO NOT NEED TO CALL TOOLS:
- Generate your final response based on the user instructions and any function results from the conversation history
</ToolCallHints>`;
  }
}
