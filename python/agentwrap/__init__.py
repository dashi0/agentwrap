"""
AgentWrap - Agent-First AI Framework

Let AI agents make decisions, not code.
"""

__version__ = "0.1.0"

# Core agent interfaces
from .agent import BaseAgent, JSONExtractor, StructuredOutputParser, create_structured_prompt

# Agent implementations
from .agents import CodexAgent

# Server
from .base_server import BaseServer
from .servers import OpenAICompatibleServer, OpenAIServerOptions

# Configuration
from .config import (
    AgentInput,
    AllAgentConfigs,
    AnthropicSkillConfig,
    CodexAgentConfig,
    MCPSkillConfig,
    MCPSSESkillConfig,
    MCPStdioSkillConfig,
)

# Events
from .events import (
    CommandExecutionEvent,
    ErrorEvent,
    Event,
    EventType,
    MessageEvent,
    ReasoningEvent,
    SkillInvokedEvent,
    ThreadStartedEvent,
    TurnCompletedEvent,
    TurnStartedEvent,
)

__all__ = [
    # Agent
    "BaseAgent",
    "CodexAgent",
    # Server
    "BaseServer",
    "OpenAICompatibleServer",
    "OpenAIServerOptions",
    # Configuration
    "AgentInput",
    "AllAgentConfigs",
    "AnthropicSkillConfig",
    "CodexAgentConfig",
    "MCPSkillConfig",
    "MCPStdioSkillConfig",
    "MCPSSESkillConfig",
    # Events
    "Event",
    "EventType",
    "MessageEvent",
    "ReasoningEvent",
    "CommandExecutionEvent",
    "SkillInvokedEvent",
    "ThreadStartedEvent",
    "TurnStartedEvent",
    "TurnCompletedEvent",
    "ErrorEvent",
    # Structured output
    "JSONExtractor",
    "StructuredOutputParser",
    "create_structured_prompt",
]
