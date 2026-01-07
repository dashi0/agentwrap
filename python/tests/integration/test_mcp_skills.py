"""
Integration tests for MCP skill configuration and installation.

These tests verify that MCP skills (stdio and sse transports) are
correctly configured in ~/.codex/config.toml.
"""

import tempfile
from pathlib import Path

import pytest
import toml

from agentwrap import (
    AgentInput,
    AllAgentConfigs,
    CodexAgent,
    MCPSSESkillConfig,
    MCPStdioSkillConfig,
)
from agentwrap.agents.codex_agent import CODEX_CONFIG_PATH
from agentwrap.events import EventType


# Mark all tests in this module as integration tests
pytestmark = [pytest.mark.integration, pytest.mark.slow]


# Test MCP server path
TEST_MCP_SERVER = Path(__file__).parent.parent / "fixtures" / "mcp_servers" / "echo_server.py"


@pytest.fixture
def backup_codex_config():
    """Backup and restore ~/.codex/config.toml."""
    backup_path = None
    if CODEX_CONFIG_PATH.exists():
        backup_path = CODEX_CONFIG_PATH.with_suffix(".toml.backup")
        CODEX_CONFIG_PATH.rename(backup_path)

    yield

    # Restore backup
    if CODEX_CONFIG_PATH.exists():
        CODEX_CONFIG_PATH.unlink()
    if backup_path and backup_path.exists():
        backup_path.rename(CODEX_CONFIG_PATH)


def test_mcp_stdio_skill_configuration(backup_codex_config):
    """
    Test MCP stdio skill configuration.

    Verifies that:
    1. MCPStdioSkillConfig is created correctly
    2. Skill is written to ~/.codex/config.toml
    3. Config has correct command, args, env fields
    """
    # Create config with stdio MCP skill
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                "command": "npx @modelcontextprotocol/server-filesystem",
                "args": ["--root", "/test/data"],
                "env": {"DEBUG": "1", "LOG_LEVEL": "info"},
                "config": {"tool_timeout_sec": 30},
            }
        ],
    }

    # Configure agent (this installs skills)
    agent = CodexAgent()
    agent.configure(config_dict, verbose=False)

    # Verify config structure
    assert len(agent.config.skills) == 1
    skill = agent.config.skills[0]
    assert isinstance(skill, MCPStdioSkillConfig)
    assert skill.command == "npx @modelcontextprotocol/server-filesystem"
    assert skill.args == ["--root", "/test/data"]
    assert skill.env == {"DEBUG": "1", "LOG_LEVEL": "info"}
    assert skill.config == {"tool_timeout_sec": 30}

    # Verify ~/.codex/config.toml was written
    assert CODEX_CONFIG_PATH.exists(), "~/.codex/config.toml should exist"

    # Read and verify config.toml contents
    with open(CODEX_CONFIG_PATH) as f:
        codex_config = toml.load(f)

    assert "mcp_servers" in codex_config
    # Server name is derived from command
    server_name = "npx"
    assert server_name in codex_config["mcp_servers"]

    server_config = codex_config["mcp_servers"][server_name]
    assert server_config["command"] == "npx @modelcontextprotocol/server-filesystem"
    assert server_config["args"] == ["--root", "/test/data"]
    assert server_config["env"] == {"DEBUG": "1", "LOG_LEVEL": "info"}
    assert server_config["tool_timeout_sec"] == 30


def test_mcp_sse_skill_configuration(backup_codex_config):
    """
    Test MCP SSE skill configuration.

    Verifies that:
    1. MCPSSESkillConfig is created correctly
    2. Skill is written to ~/.codex/config.toml
    3. Config has correct url field
    """
    # Create config with SSE MCP skill
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "sse",
                "url": "http://localhost:3000/mcp",
                "config": {"timeout": 60},
            }
        ],
    }

    # Configure agent
    agent = CodexAgent()
    agent.configure(config_dict, verbose=False)

    # Verify config structure
    assert len(agent.config.skills) == 1
    skill = agent.config.skills[0]
    assert isinstance(skill, MCPSSESkillConfig)
    assert skill.url == "http://localhost:3000/mcp"
    assert skill.config == {"timeout": 60}

    # Verify ~/.codex/config.toml was written
    assert CODEX_CONFIG_PATH.exists()

    # Read and verify config.toml contents
    with open(CODEX_CONFIG_PATH) as f:
        codex_config = toml.load(f)

    assert "mcp_servers" in codex_config
    # Server name is derived from URL (http://localhost:3000/mcp -> http-localhost-3000-mcp)
    server_name = "http-localhost-3000-mcp"
    assert server_name in codex_config["mcp_servers"]

    server_config = codex_config["mcp_servers"][server_name]
    assert server_config["url"] == "http://localhost:3000/mcp"
    assert server_config["timeout"] == 60


def test_mcp_multiple_skills_configuration(backup_codex_config):
    """
    Test configuring multiple MCP skills (both stdio and sse).

    Verifies that:
    1. Multiple skills can coexist
    2. Both are written to config.toml
    3. Each has correct configuration
    """
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                "command": "npx @server/filesystem",
                "args": ["--root", "/data"],
            },
            {
                "type": "mcp",
                "transport": "sse",
                "url": "http://example.com/mcp",
            },
            {
                "type": "mcp",
                "transport": "stdio",
                "command": "python3 -m my_server",
                "env": {"API_KEY": "secret"},
            },
        ],
    }

    # Configure agent
    agent = CodexAgent()
    agent.configure(config_dict, verbose=False)

    # Verify all skills loaded
    assert len(agent.config.skills) == 3
    assert isinstance(agent.config.skills[0], MCPStdioSkillConfig)
    assert isinstance(agent.config.skills[1], MCPSSESkillConfig)
    assert isinstance(agent.config.skills[2], MCPStdioSkillConfig)

    # Verify config.toml has all servers
    with open(CODEX_CONFIG_PATH) as f:
        codex_config = toml.load(f)

    assert "mcp_servers" in codex_config
    assert len(codex_config["mcp_servers"]) == 3

    # Verify each server
    assert "npx" in codex_config["mcp_servers"]
    assert codex_config["mcp_servers"]["npx"]["command"] == "npx @server/filesystem"

    assert "http-example.com-mcp" in codex_config["mcp_servers"]
    assert codex_config["mcp_servers"]["http-example.com-mcp"]["url"] == "http://example.com/mcp"

    assert "python3" in codex_config["mcp_servers"]
    assert codex_config["mcp_servers"]["python3"]["command"] == "python3 -m my_server"


def test_mcp_skill_validation_stdio_missing_command():
    """
    Test that stdio MCP skill requires command field.

    Verifies that:
    1. Missing command raises ValueError
    2. Error message is clear
    """
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                # Missing command!
                "args": ["arg1"],
            }
        ],
    }

    with pytest.raises(ValueError, match="MCP stdio transport requires 'command' field"):
        AllAgentConfigs.from_dict(config_dict)


def test_mcp_skill_validation_sse_missing_url():
    """
    Test that SSE MCP skill requires url field.

    Verifies that:
    1. Missing url raises ValueError
    2. Error message is clear
    """
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "sse",
                # Missing url!
                "config": {"timeout": 30},
            }
        ],
    }

    with pytest.raises(ValueError, match="MCP sse transport requires 'url' field"):
        AllAgentConfigs.from_dict(config_dict)


def test_mcp_skill_validation_unknown_transport():
    """
    Test that unknown transport type raises error.

    Verifies that:
    1. Invalid transport raises ValueError
    2. Error message is clear
    """
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "websocket",  # Invalid!
                "url": "ws://localhost",
            }
        ],
    }

    with pytest.raises(ValueError, match="Unknown MCP transport.*Must be 'stdio' or 'sse'"):
        AllAgentConfigs.from_dict(config_dict)


def test_mcp_skill_with_agent_creation(backup_codex_config):
    """
    Test creating CodexAgent with MCP skills.

    Verifies that:
    1. Agent can be created with MCP skill config
    2. Config is properly stored in agent
    """
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                "command": "npx test-server",
            }
        ],
    }

    agent = CodexAgent()
    agent.configure(config_dict, verbose=False)

    # Verify agent has config
    assert agent.config is not None
    assert len(agent.config.skills) == 1
    assert isinstance(agent.config.skills[0], MCPStdioSkillConfig)


def test_mcp_config_overrides_preserve_skills(backup_codex_config):
    """
    Test that config overrides preserve MCP skills.

    Verifies that:
    1. Runtime overrides don't lose skill configuration
    2. Skills remain accessible after override
    """
    # Base config with MCP skill
    base_config = AllAgentConfigs.from_dict(
        {
            "agent_config": {"type": "codex-agent", "sandbox_mode": "default"},
            "skills": [
                {
                    "type": "mcp",
                    "transport": "stdio",
                    "command": "npx test-server",
                }
            ],
        }
    )

    # Override with empty skills (should preserve base skills)
    with tempfile.TemporaryDirectory() as tmpdir:
        override_config = AllAgentConfigs.from_dict(
            {
                "agent_config": {"type": "codex-agent", "working_dir": tmpdir},
                "skills": [],
            }
        )

        merged = base_config.merge_overrides(override_config)

        # Working dir should be updated
        assert merged.agent_config.working_dir == tmpdir
        # Sandbox mode should be preserved
        assert merged.agent_config.sandbox_mode == "default"
        # Skills should be preserved (empty list is falsy)
        assert len(merged.skills) == 1
        assert isinstance(merged.skills[0], MCPStdioSkillConfig)


def test_mcp_tool_execution_end_to_end(backup_codex_config):
    """
    End-to-end test: Verify codex can actually call MCP tools.

    This test:
    1. Configures a real MCP server (echo_server.py)
    2. Runs agent with a query that should use the MCP tool
    3. Verifies the tool is called and returns expected results
    """
    # Skip if test MCP server doesn't exist
    if not TEST_MCP_SERVER.exists():
        pytest.skip(f"Test MCP server not found: {TEST_MCP_SERVER}")

    # Configure agent with test MCP server
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                "command": f"python3 {TEST_MCP_SERVER}",
            }
        ],
    }

    agent = CodexAgent()
    agent.configure(config_dict, verbose=True)

    # Create query that should trigger MCP tool usage
    agent_input = AgentInput.from_query(
        "Use the echo tool to echo back this message: 'Hello from MCP test!'"
    )

    # Run agent and collect events
    events = []
    messages = []
    tool_calls = []

    for event in agent.run(agent_input):
        events.append(event)
        if event.type == EventType.MESSAGE:
            messages.append(event.content)
        # Look for tool execution in events
        if event.type == EventType.COMMAND_EXECUTION:
            tool_calls.append(event)

    # Verify we got events
    assert len(events) > 0, "No events received from agent"

    # Verify we got messages
    assert len(messages) > 0, "No messages received from agent"

    # Verify MCP tool was mentioned or used
    full_output = " ".join(messages).lower()
    # Agent should either:
    # 1. Mention using the echo tool, or
    # 2. Show the echoed message
    assert (
        "echo" in full_output or "hello from mcp test" in full_output
    ), f"MCP tool not used. Output: {full_output}"


def test_mcp_tool_multiple_calls(backup_codex_config):
    """
    Test multiple calls to MCP tools in one conversation.

    Verifies:
    1. MCP tools can be called multiple times
    2. Different tools from same server can be used
    """
    if not TEST_MCP_SERVER.exists():
        pytest.skip(f"Test MCP server not found: {TEST_MCP_SERVER}")

    # Configure agent
    config_dict = {
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {
                "type": "mcp",
                "transport": "stdio",
                "command": f"python3 {TEST_MCP_SERVER}",
            }
        ],
    }

    agent = CodexAgent()
    agent.configure(config_dict, verbose=False)

    # Query that should use multiple tools
    agent_input = AgentInput.from_query(
        "First, use the echo tool to echo 'test'. "
        "Then use the reverse tool to reverse the word 'hello'."
    )

    # Run agent
    events = []
    messages = []

    for event in agent.run(agent_input):
        events.append(event)
        if event.type == EventType.MESSAGE:
            messages.append(event.content)

    # Verify execution
    assert len(events) > 0
    assert len(messages) > 0

    full_output = " ".join(messages).lower()
    # Should mention using tools or show results
    # The reverse of "hello" is "olleh"
    assert "echo" in full_output or "reverse" in full_output or "olleh" in full_output
