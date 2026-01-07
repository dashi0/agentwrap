"""
Prompts - Centralized prompt management

All prompt assembly logic is consolidated here, allowing users to
customize prompts by extending this class or providing a custom instance.
"""

from typing import List, Optional, Any, Dict, Tuple


class Prompts:
    """
    Prompts class handles all prompt assembly in the library.
    Users can extend this class to customize prompts.
    """

    USER_DEFINED_FUNCTIONS_MCP_NAME = "userDefinedFunctions"

    def __init__(self, system_prompt: Optional[str] = None):
        self.system_prompt = system_prompt or (
            'Understand the conversation below and respond appropriately. '
            'Follow any instructions given by the user.'
        )

    def messages_to_prompt(self, messages: List[Dict[str, Any]]) -> str:
        """
        Convert message array to prompt string.
        Used when normalizing AgentInput from Message[].
        """
        if not messages:
            raise ValueError('No messages provided to convert to prompt.')

        message_xml = '\n'.join(
            f'  <Message role="{msg["role"]}">{msg["content"]}</Message>'
            for msg in messages
        )

        return f"""<SystemInstructions>
{self.system_prompt}
</SystemInstructions>
<Conversation>
{message_xml}
</Conversation>"""

    def structured_output_prompt(
        self,
        query: str,
        schema: Dict[str, Any],
        previous_attempts: List[Tuple[str, Exception]]
    ) -> str:
        """
        Create structured output prompt with JSON schema.
        Used by runStructured() to enforce JSON response format.
        """
        import json

        parts = [query]

        parts.append(f"""
<OutputFormat>
IMPORTANT: You MUST respond with valid JSON matching this schema:
```json
{json.dumps(schema, indent=2)}
```

Respond with ONLY the JSON, no additional text.
</OutputFormat>
      """)

        if previous_attempts:
            parts.append('\n\n<PreviousAttempts>\nPrevious attempts to provide valid JSON:\n')
            for index, (output, error) in enumerate(previous_attempts):
                parts.append(
                    f'\nAttempt {index + 1}:\n```json\n{output}\n```\nError: {str(error)}\n'
                )
            parts.append('\nPlease correct the above errors and provide valid JSON this time.\n</PreviousAttempts>\n')

        return ''.join(parts)

    def function_call_history_to_prompt(self, messages: List[Dict[str, Any]]) -> str:
        """
        Convert OpenAI ChatCompletion message history to prompt.
        Used by OpenAI-compatible server to convert request messages to agent prompt.
        """
        def format_message(message: Dict[str, Any]) -> str:
            role = message.get('role')

            # Handle tool/function messages with tool_call_id
            if (role == 'tool' or role == 'function') and 'tool_call_id' in message:
                tool_call_id = message['tool_call_id']
                content = message.get('content', '')
                return f'  <Message role="{role}" tool_call_id="{tool_call_id}">{content}</Message>'

            # Handle new tool_calls format (OpenAI API 2023-11+)
            if 'tool_calls' in message and message['tool_calls']:
                tool_calls_xml = '\n    '.join(
                    f'<ToolCall id="{tc["id"]}" type="{tc["type"]}" name="{tc["function"]["name"]}">'
                    f'{tc["function"]["arguments"]}</ToolCall>'
                    for tc in message['tool_calls']
                )
                return f'  <Message role="{role}">\n    {tool_calls_xml}\n  </Message>'

            # Handle legacy function_call format (deprecated)
            if 'function_call' in message and message['function_call']:
                import json
                func_call = message['function_call']
                args_json = json.dumps(func_call['arguments'], indent=2)
                return f'  <Message role="{role}"><FunctionCall name="{func_call["name"]}">{args_json}</FunctionCall></Message>'

            # Regular message
            content = message.get('content', '')
            return f'  <Message role="{role}">{content}</Message>'

        message_xml = '\n'.join(format_message(msg) for msg in messages)

        return f"""<SystemInstructions>
{self.system_prompt}
</SystemInstructions>
<Conversation>
{message_xml}
</Conversation>

"""

    def prepend_tool_calling_instructions(
        self,
        original_prompt: str,
        functions: List[Dict[str, Any]],
        prefix: Optional[str] = None
    ) -> str:
        """
        Prepend tool calling instructions to a prompt.
        Used by BaseServer when handling requests with function definitions.

        Args:
            original_prompt: The base prompt
            functions: List of available functions
            prefix: Optional request ID prefix for function names (e.g., "abc123" for functions like "abc123_getUserId")
        """
        if not functions:
            return original_prompt

        function_list = '\n'.join(
            f"- {f['name']}: {f.get('description', 'No description')}"
            for f in functions
        )

        # Build the MCP tool pattern - if prefix is provided, use it to help agent identify the functions
        mcp_tool_pattern = (
            f"{Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME}.{prefix}_*"
            if prefix
            else f"{Prompts.USER_DEFINED_FUNCTIONS_MCP_NAME}.*"
        )

        return f"""{original_prompt}
<ToolCallHints>
You have access to the following tools/functions:

{function_list}

DECISION PROCESS:
1. First, carefully read the user instructions and tool calling history in the <Conversation /> above.

    * Pay special attention to any <Message role="tool"/> or <Message role="function"/> entries, as they contain results from previous tool calls.
      The results you need may already be present - DO NOT call functions that have already been called with the same name/arguments

2. Decide whether you need to call any tools/functions OR provide a final response

IF YOU NEED TO CALL TOOLS:
- Invoke it directly using MCP tools {mcp_tool_pattern}
- DO NOT write descriptive text like "I will call..." or "Waiting for..." - just call the function

IF YOU DO NOT NEED TO CALL TOOLS:
- Generate your final response based on the user instructions and any function results from the conversation history
</ToolCallHints>"""
