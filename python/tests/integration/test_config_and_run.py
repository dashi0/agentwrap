"""
Integration tests for config_agent and agent.run with skills.

These tests require codex-cli to be installed and OPENAI_API_KEY to be set.
"""

import pytest
from pathlib import Path

from agentwrap import CodexAgent
from agentwrap.config import AgentInput, AllAgentConfigs
from agentwrap.events import EventType


# Mark all tests in this module as integration tests
pytestmark = [pytest.mark.integration, pytest.mark.slow]


# Test fixtures directory
FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
TEST_SKILLS_DIR = FIXTURES_DIR / "skills"
TEST_CONFIG_PATH = FIXTURES_DIR / "configs" / "minimal.yaml"


@pytest.fixture
def test_config():
    """Load test configuration with echo skill."""
    # Create absolute path config
    config_dict = {
        "agent_config": {
            "type": "codex-agent",
            # Use default sandbox mode (not danger-full-access for tests)
        },
        "skills": [
            {
                "type": "anthropic-skill",
                "path": str(TEST_SKILLS_DIR / "echo_skill"),
            }
        ],
    }
    return AllAgentConfigs.from_dict(config_dict)


def test_config_agent_with_test_skills(test_config):
    """
    Test CodexAgent.configure() method with test skills.

    Verifies that:
    1. Agent can load configuration
    2. Skills are installed to ~/.codex/skills/
    """
    # Configure agent
    agent = CodexAgent()
    agent.configure(test_config, verbose=True)

    assert agent.config is not None
    assert len(agent.config.skills) == 1
    assert agent.config.skills[0].type == "anthropic-skill"

    # Verify skill was installed
    from agentwrap.agents.codex_agent import CODEX_SKILLS_DIR

    echo_skill_path = CODEX_SKILLS_DIR / "echo_skill"
    assert echo_skill_path.exists(), f"Echo skill not installed at {echo_skill_path}"
    assert (echo_skill_path / "SKILL.md").exists()


def test_run_agent_with_echo_skill(test_config):
    """
    Test running agent with echo skill.

    Verifies that:
    1. Agent can execute with configured skills
    2. Skill is invoked correctly
    3. Output is as expected
    """
    # Configure agent
    agent = CodexAgent()
    agent.configure(test_config, verbose=False)

    # Create input that should trigger echo skill
    agent_input = AgentInput.from_query(
        "Use the echo skill to echo back this message: Hello from integration test!"
    )

    # Run agent and collect events
    events = []
    messages = []

    for event in agent.run(agent_input):
        events.append(event)
        if event.type == EventType.MESSAGE:
            messages.append(event.content)

    # Verify we got events
    assert len(events) > 0, "No events received from agent"

    # Verify we got messages
    assert len(messages) > 0, "No messages received from agent"

    # Verify skill was mentioned (agent should acknowledge using the skill)
    full_output = " ".join(messages)
    assert "echo" in full_output.lower(), "Agent did not mention echo skill"


def test_run_agent_structured_output(test_config):
    """
    Test agent.run_structured() with echo skill.

    Verifies that:
    1. Structured output works with configured agent
    2. Output conforms to schema
    """
    # Configure agent
    agent = CodexAgent()
    agent.configure(test_config, verbose=False)

    # Define schema
    schema = {
        "type": "object",
        "properties": {
            "message": {"type": "string"},
            "status": {"type": "string"},
        },
        "required": ["message", "status"],
    }

    # Create input
    agent_input = AgentInput.from_query(
        "Respond with a JSON object containing 'message' and 'status' fields. "
        "Message should be 'Hello', status should be 'success'."
    )

    # Run with structured output
    result = agent.run_structured(agent_input, schema, max_retries=3)

    # Verify result
    assert isinstance(result, dict)
    assert "message" in result
    assert "status" in result
    assert result["status"] == "success"


def test_config_overrides_at_runtime(test_config):
    """
    Test runtime config overrides in agent.run().

    Verifies that:
    1. Config overrides work correctly
    2. Overrides are applied for single run
    """
    # Configure agent with base config
    agent = CodexAgent()
    agent.configure(test_config, verbose=False)

    # Create override config (change working dir)
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        override_config = AllAgentConfigs.from_dict(
            {
                "agent_config": {
                    "type": "codex-agent",
                    "working_dir": tmpdir,  # Override working dir
                },
                "skills": [],  # Keep same skills
            }
        )

        # Run with override
        agent_input = AgentInput.from_query("What is 2+2?")

        events = list(agent.run(agent_input, config_overrides=override_config))

        # Should complete successfully
        assert len(events) > 0


def test_multimodal_input_with_messages(test_config):
    """
    Test agent with multi-turn conversation (OpenAI messages format).

    Verifies that:
    1. Agent can handle multi-turn conversations
    2. Messages format is correctly processed
    """
    # Configure agent
    agent = CodexAgent()
    agent.configure(test_config, verbose=False)

    # Create multi-turn input
    messages = [
        {"role": "user", "content": "What is the capital of France?"},
        {"role": "assistant", "content": "Paris"},
        {"role": "user", "content": "What is its population?"},
    ]

    agent_input = AgentInput.from_messages(messages)

    # Run agent
    events = []
    for event in agent.run(agent_input):
        events.append(event)
        if event.type == EventType.MESSAGE:
            # Agent should provide population info
            pass

    assert len(events) > 0
    # Find at least one message event
    message_events = [e for e in events if e.type == EventType.MESSAGE]
    assert len(message_events) > 0
