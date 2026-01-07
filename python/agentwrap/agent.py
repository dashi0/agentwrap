"""Base agent interface and implementations."""

import json
import os
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, Iterator, List, Optional, Union

from jsonschema import ValidationError, validate

from .config import AgentInput, AllAgentConfigs
from .events import Event, EventType


# ============================================================================
# Structured Output Utilities (from structured_output.py)
# ============================================================================


class JSONExtractor:
    """Extract and validate JSON from agent output"""

    @staticmethod
    def extract(text: str) -> Optional[Dict[str, Any]]:
        """
        Try multiple strategies to extract JSON from text.

        Strategies:
        1. Direct JSON parse (if entire text is JSON)
        2. Extract from markdown code block
        3. Extract from text using heuristics

        Returns:
            Parsed JSON dict or None if extraction fails
        """
        # Strategy 1: Direct parse
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            pass

        # Strategy 2: Extract from markdown code block
        # Pattern: ```json\n{...}\n``` or ```\n{...}\n```
        patterns = [
            r"```json\s*\n(.*?)\n```",
            r"```\s*\n(.*?)\n```",
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    continue

        # Strategy 3: Find JSON-like structure in text
        # Look for { ... } or [ ... ]
        brace_patterns = [
            r"\{[^}]*\}",  # Simple object
            r"\{.*?\}",  # Object (non-greedy)
            r"\[.*?\]",  # Array (non-greedy)
        ]

        for pattern in brace_patterns:
            matches = re.findall(pattern, text, re.DOTALL)
            for match in reversed(matches):  # Try longest matches first
                try:
                    result = json.loads(match)
                    if isinstance(result, (dict, list)):
                        return result
                except json.JSONDecodeError:
                    continue

        return None

    @staticmethod
    def validate_schema(data: Dict[str, Any], schema: Dict[str, Any]) -> bool:
        """
        Validate JSON data against JSON schema.

        Args:
            data: JSON data to validate
            schema: JSON schema (simplified format)

        Returns:
            True if valid, raises ValidationError if not
        """
        try:
            validate(instance=data, schema=schema)
            return True
        except ValidationError as e:
            raise ValueError(f"Schema validation failed: {e.message}")


class StructuredOutputParser:
    """Parse and validate structured output from agent"""

    def __init__(self, schema: Dict[str, Any]):
        """
        Initialize parser with expected schema.

        Args:
            schema: JSON schema describing expected output format
        """
        self.schema = schema
        self.extractor = JSONExtractor()

    def parse(self, agent_output: str) -> Dict[str, Any]:
        """
        Parse agent output and validate against schema.

        Args:
            agent_output: Raw text output from agent

        Returns:
            Validated JSON dict

        Raises:
            ValueError: If parsing or validation fails
        """
        # Extract JSON
        data = self.extractor.extract(agent_output)

        if data is None:
            raise ValueError(
                "Failed to extract JSON from agent output. "
                "Output should contain valid JSON structure."
            )

        # Validate against schema
        try:
            self.extractor.validate_schema(data, self.schema)
        except ValueError as e:
            raise ValueError(f"Validation failed: {str(e)}")

        return data


def create_structured_prompt(
    query: str, schema: Dict[str, Any], examples: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Create a prompt that encourages structured JSON output.

    Args:
        query: User query
        schema: Expected JSON schema
        examples: Optional examples of valid output

    Returns:
        Formatted prompt string
    """
    prompt_parts = [query]

    prompt_parts.append("\n\nIMPORTANT: You MUST respond with valid JSON matching this schema:")
    prompt_parts.append(f"```json\n{json.dumps(schema, indent=2)}\n```")

    if examples:
        prompt_parts.append("\n\nExamples of valid output:")
        for i, example in enumerate(examples, 1):
            prompt_parts.append(f"\nExample {i}:")
            prompt_parts.append(f"```json\n{json.dumps(example, indent=2)}\n```")

    prompt_parts.append("\n\nRespond with ONLY the JSON, no additional text.")

    return "\n".join(prompt_parts)


# ============================================================================
# Base Agent
# ============================================================================


class BaseAgent(ABC):
    """
    Abstract base class for all agent implementations.

    This provides a unified interface for different AI agents
    (Codex, Claude, etc.) to execute tasks with skills/tools.
    """

    def __init__(self):
        """Initialize agent."""
        self.config: Optional[AllAgentConfigs] = None

    def _normalize_input(self, agent_input: Union[AgentInput, str]) -> AgentInput:
        """
        Normalize input to AgentInput format.
        Accepts either AgentInput object or a simple string query.

        Args:
            agent_input: AgentInput object or string query

        Returns:
            AgentInput object
        """
        if isinstance(agent_input, str):
            return AgentInput.from_query(agent_input)
        return agent_input

    @abstractmethod
    def run(
        self,
        agent_input: Union[AgentInput, str],
        config_overrides: Optional[AllAgentConfigs] = None,
    ) -> Iterator[Event]:
        """
        Execute agent with streaming output.

        Accepts either an AgentInput object or a simple string query.
        If a string is provided, it will be automatically converted to AgentInput.

        Args:
            agent_input: AgentInput object or string query
            config_overrides: Optional runtime configuration overrides

        Yields:
            Event objects (reasoning, tool_use, message, etc.)
        """
        pass

    def run_structured(
        self,
        agent_input: Union[AgentInput, str],
        schema: Dict[str, Any],
        examples: Optional[List[Dict[str, Any]]] = None,
        max_retries: int = 3,
        config_overrides: Optional[AllAgentConfigs] = None,
    ) -> Dict[str, Any]:
        """
        Execute agent and ensure structured JSON output.

        This is a general pattern for guaranteed format output.
        Default implementation uses StructuredOutputParser.

        Args:
            agent_input: Input containing messages
            schema: JSON schema for expected output
            examples: Optional examples of valid output
            max_retries: Maximum retry attempts
            config_overrides: Optional runtime configuration overrides

        Returns:
            Validated JSON dict matching schema

        Raises:
            ValueError: If parsing fails after all retries
        """
        parser = StructuredOutputParser(schema)

        # Normalize input
        normalized_input = self._normalize_input(agent_input)

        # Get the user query from messages
        last_message = normalized_input.messages[-1]["content"]
        structured_query = create_structured_prompt(last_message, schema, examples)

        # Create new input with structured prompt
        structured_messages = normalized_input.messages[:-1] + [
            {"role": "user", "content": structured_query}
        ]
        structured_input = AgentInput(
            messages=structured_messages,
            functions=normalized_input.functions,
            temperature=normalized_input.temperature,
            max_tokens=normalized_input.max_tokens,
        )

        last_error = None
        for attempt in range(max_retries):
            try:
                # Collect agent messages
                messages = []
                for event in self.run(structured_input, config_overrides):
                    if event.type == EventType.MESSAGE:
                        messages.append(event.content or "")

                full_output = "\n\n".join(messages)
                result = parser.parse(full_output)
                return result

            except ValueError as e:
                last_error = e
                if attempt < max_retries - 1:
                    # Retry with more explicit instructions
                    retry_query = (
                        f"{last_message}\n\nPrevious attempt failed: {e}\n"
                        f"Please ensure you output VALID JSON."
                    )
                    structured_query = create_structured_prompt(
                        retry_query, schema, examples
                    )
                    structured_messages = normalized_input.messages[:-1] + [
                        {"role": "user", "content": structured_query}
                    ]
                    structured_input = AgentInput(
                        messages=structured_messages,
                        functions=normalized_input.functions,
                    )

        raise ValueError(
            f"Failed to get valid structured output after {max_retries} attempts. "
            f"Last error: {last_error}"
        )
