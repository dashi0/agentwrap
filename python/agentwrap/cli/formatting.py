"""Event formatting for terminal output."""

from typing import Optional

from ..events import Event, EventType


def format_event(event: Event, verbose: bool = False) -> Optional[str]:
    """
    Format event for terminal output.

    Args:
        event: Event to format
        verbose: Include verbose details (reasoning, command execution)

    Returns:
        Formatted string or None if event should be skipped
    """
    if event.type == EventType.MESSAGE:
        return event.content

    if event.type == EventType.REASONING and verbose:
        return f"💭 {event.content}"

    if event.type == EventType.COMMAND_EXECUTION and verbose:
        output = [f"⚙️  Executing: {event.command}"]
        if event.output:
            # Truncate very long output
            output_text = event.output
            if len(output_text) > 1000:
                output_text = output_text[:1000] + "... (truncated)"
            output.append(output_text)
        return "\n".join(output)

    if event.type == EventType.SKILL_INVOKED and verbose:
        return f"🔧 Using skill: {event.skill_name}"

    if event.type == EventType.TURN_COMPLETED and verbose:
        if event.usage:
            tokens = event.usage.get("total_tokens", "N/A")
            return f"📊 Turn completed (tokens: {tokens})"

    if event.type == EventType.ERROR:
        return f"❌ Error: {event.content}"

    # Skip other event types (thread_started, turn_started, etc.)
    return None
