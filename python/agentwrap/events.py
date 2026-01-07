"""Event data structures for agent execution."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Union


class EventType(Enum):
    """Types of events emitted by agents during execution."""

    THREAD_STARTED = "thread_started"
    TURN_STARTED = "turn_started"
    REASONING = "reasoning"
    COMMAND_EXECUTION = "command_execution"
    SKILL_INVOKED = "skill_invoked"
    MESSAGE = "message"
    TURN_COMPLETED = "turn_completed"
    ERROR = "error"


# ============================================================================
# Specific Event Types
# ============================================================================


@dataclass
class ThreadStartedEvent:
    """Event emitted when a new thread starts."""

    type: EventType = field(default=EventType.THREAD_STARTED, init=False)
    thread_id: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TurnStartedEvent:
    """Event emitted when a new turn starts."""

    type: EventType = field(default=EventType.TURN_STARTED, init=False)
    thread_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReasoningEvent:
    """Event emitted when agent is reasoning/thinking."""

    type: EventType = field(default=EventType.REASONING, init=False)
    content: str = ""  # Reasoning text
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CommandExecutionEvent:
    """Event emitted when agent executes a command."""

    type: EventType = field(default=EventType.COMMAND_EXECUTION, init=False)
    command: str = ""  # Command executed
    output: str = ""  # Command output
    exit_code: Optional[int] = None  # Exit code
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillInvokedEvent:
    """Event emitted when agent invokes a skill/tool."""

    type: EventType = field(default=EventType.SKILL_INVOKED, init=False)
    skill_name: str = ""  # Name of skill invoked
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MessageEvent:
    """Event emitted when agent produces a message."""

    type: EventType = field(default=EventType.MESSAGE, init=False)
    content: str = ""  # Message content
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TurnCompletedEvent:
    """Event emitted when a turn completes."""

    type: EventType = field(default=EventType.TURN_COMPLETED, init=False)
    usage: Optional[Dict[str, Any]] = None  # Token usage stats
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ErrorEvent:
    """Event emitted when an error occurs."""

    type: EventType = field(default=EventType.ERROR, init=False)
    content: str = ""  # Error message
    metadata: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Union Type for All Events
# ============================================================================

Event = Union[
    ThreadStartedEvent,
    TurnStartedEvent,
    ReasoningEvent,
    CommandExecutionEvent,
    SkillInvokedEvent,
    MessageEvent,
    TurnCompletedEvent,
    ErrorEvent,
]

