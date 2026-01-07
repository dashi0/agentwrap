"""
OpenAI Chat Completion API types.

These types mirror the OpenAI API for compatibility with existing clients.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union


@dataclass
class ChatCompletionFunctionParameters:
    """Function parameters schema."""

    type: str = "object"
    properties: Dict[str, Any] = field(default_factory=dict)
    required: List[str] = field(default_factory=list)


@dataclass
class ChatCompletionFunction:
    """Function definition for function calling."""

    name: str
    description: Optional[str] = None
    parameters: ChatCompletionFunctionParameters = field(
        default_factory=ChatCompletionFunctionParameters
    )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result: Dict[str, Any] = {"name": self.name}
        if self.description:
            result["description"] = self.description
        result["parameters"] = {
            "type": self.parameters.type,
            "properties": self.parameters.properties,
        }
        if self.parameters.required:
            result["parameters"]["required"] = self.parameters.required
        return result


@dataclass
class ChatCompletionTool:
    """Tool definition (new format)."""

    type: Literal["function"] = "function"
    function: Optional[ChatCompletionFunction] = None


@dataclass
class ChatCompletionFunctionCall:
    """Function call result."""

    name: str
    arguments: str  # JSON string


@dataclass
class ChatCompletionToolCall:
    """Tool call result."""

    id: str
    type: Literal["function"] = "function"
    function: Optional[ChatCompletionFunctionCall] = None


# Message types
@dataclass
class ChatCompletionMessageBase:
    """Base message type."""

    role: Literal["system", "user", "assistant", "tool", "function"]
    content: Optional[str] = None
    name: Optional[str] = None


@dataclass
class ChatCompletionUserMessage(ChatCompletionMessageBase):
    """User message."""

    role: Literal["user"] = "user"
    content: str = ""


@dataclass
class ChatCompletionAssistantMessage(ChatCompletionMessageBase):
    """Assistant message."""

    role: Literal["assistant"] = "assistant"
    content: Optional[str] = None
    tool_calls: Optional[List[ChatCompletionToolCall]] = None
    function_call: Optional[ChatCompletionFunctionCall] = None  # Legacy


@dataclass
class ChatCompletionToolMessage(ChatCompletionMessageBase):
    """Tool response message."""

    role: Literal["tool"] = "tool"
    content: str = ""
    tool_call_id: str = ""


@dataclass
class ChatCompletionFunctionMessage(ChatCompletionMessageBase):
    """Function response message (legacy)."""

    role: Literal["function"] = "function"
    content: str = ""
    name: str = ""


# Union type for all messages
ChatCompletionMessage = Union[
    ChatCompletionUserMessage,
    ChatCompletionAssistantMessage,
    ChatCompletionToolMessage,
    ChatCompletionFunctionMessage,
    Dict[str, Any],  # Allow dict for flexibility
]


@dataclass
class ChatCompletionRequest:
    """Chat completion request."""

    model: str
    messages: List[Any]  # List of messages (dict or dataclass)
    # Function calling (new format)
    tools: Optional[List[ChatCompletionTool]] = None
    tool_choice: Optional[
        Union[Literal["none", "auto", "required"], Dict[str, Any]]
    ] = None
    # Function calling (legacy format)
    functions: Optional[List[Dict[str, Any]]] = None
    function_call: Optional[Union[Literal["none", "auto"], Dict[str, Any]]] = None
    # Streaming
    stream: bool = False
    # Other parameters
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@dataclass
class ChatCompletionChoice:
    """Choice in completion response."""

    index: int
    message: ChatCompletionAssistantMessage
    finish_reason: Optional[Literal["stop", "tool_calls"]] = None


@dataclass
class ChatCompletionResponse:
    """Chat completion response."""

    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int = 0
    model: str = ""
    choices: List[ChatCompletionChoice] = field(default_factory=list)


# Streaming response types
@dataclass
class ChatCompletionChunkDelta:
    """Delta in streaming chunk."""

    role: Optional[Literal["assistant"]] = None
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None


@dataclass
class ChatCompletionChunkChoice:
    """Choice in streaming chunk."""

    index: int
    delta: ChatCompletionChunkDelta
    finish_reason: Optional[Literal["stop", "tool_calls"]] = None


@dataclass
class ChatCompletionChunk:
    """Streaming chunk."""

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int = 0
    model: str = ""
    choices: List[ChatCompletionChunkChoice] = field(default_factory=list)


# Error response
@dataclass
class ErrorResponse:
    """Error response."""

    error: Dict[str, Any] = field(default_factory=dict)
