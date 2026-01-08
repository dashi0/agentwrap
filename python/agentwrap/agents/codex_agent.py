"""CodexAgent implementation using OpenAI Codex CLI."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Union

import toml

from ..agent import BaseAgent
from ..config import (
    AgentInput,
    AllAgentConfigs,
    AnthropicSkillConfig,
    CodexAgentConfig,
    MCPSSESkillConfig,
    MCPStdioSkillConfig,
)
from ..events import (
    CommandExecutionEvent,
    Event,
    EventType,
    MessageEvent,
    ReasoningEvent,
    SkillInvokedEvent,
    ThreadStartedEvent,
    TurnCompletedEvent,
    TurnStartedEvent,
)


# Codex configuration paths
CODEX_DIR = Path.home() / ".codex"
CODEX_SKILLS_DIR = CODEX_DIR / "skills"
CODEX_CONFIG_PATH = CODEX_DIR / "config.toml"
CODEX_AUTH_PATH = CODEX_DIR / "auth.json"


class CodexAgent(BaseAgent):
    """
    Agent implementation using OpenAI Codex CLI.

    This wraps the codex-cli tool and provides streaming
    event-based execution with skills support.
    """

    def __init__(self):
        """Initialize Codex agent."""
        super().__init__()

    def configure(
        self,
        config: "Union[AllAgentConfigs, Dict[str, Any]]",
        verbose: bool = False,
    ) -> "CodexAgent":
        """
        Configure agent with skills and settings.

        This method loads configuration and installs skills.

        Args:
            config: Configuration as AllAgentConfigs or dict
            verbose: Print configuration details

        Returns:
            Self for method chaining

        Raises:
            ValueError: If config format is invalid

        Examples:
            From dict:
            ```python
            agent = CodexAgent()
            agent.configure({
                "agent_config": {
                    "type": "codex-agent",
                    "api_key": "sk-...",
                },
                "skills": [
                    {
                        "type": "anthropic-skill",
                        "path": "./skills/my-skill"
                    }
                ]
            })
            ```

            Method chaining:
            ```python
            agent = CodexAgent().configure({...}, verbose=True)
            ```
        """
        from typing import Any, Dict, Union

        # Parse config
        if isinstance(config, AllAgentConfigs):
            all_configs = config
        elif isinstance(config, dict):
            all_configs = AllAgentConfigs.from_dict(config)
        else:
            raise ValueError(
                f"Invalid config type: {type(config)}. "
                "Must be AllAgentConfigs or dict"
            )

        # Validate agent type
        if not isinstance(all_configs.agent_config, CodexAgentConfig):
            raise ValueError(
                f"CodexAgent requires CodexAgentConfig, got {type(all_configs.agent_config)}"
            )

        # Configure API key if provided or from environment variable
        agent_config = all_configs.agent_config
        api_key = agent_config.api_key or os.environ.get("OPENAI_API_KEY")
        if api_key:
            _configure_codex_auth(api_key, verbose=verbose)

        # Install skills
        install_codex_skills(all_configs, verbose=verbose)

        # Store config
        self.config = all_configs

        # Print config summary if verbose
        if verbose:
            all_configs.print_summary()

        return self

    def check_prerequisites(self) -> None:
        """
        Check if codex CLI is available.

        Raises:
            RuntimeError: If codex CLI is not found in PATH
        """
        if not shutil.which("codex"):
            error_msg = """
╔══════════════════════════════════════════════════════════════╗
║  Codex CLI not found!                                        ║
╚══════════════════════════════════════════════════════════════╝

AgentWrap's CodexAgent requires the Codex CLI to be installed.

📦 Installation:
   npm install -g @openai/codex

📚 Documentation:
   https://github.com/dashi0/agentwrap#prerequisites

Note: Unlike the TypeScript package, Python cannot auto-install
Node.js CLI tools. You need to install Codex globally.
"""
            raise RuntimeError(error_msg)

    def run(
        self,
        agent_input: Union[AgentInput, str],
        config_overrides: Optional[AllAgentConfigs] = None,
    ) -> Iterator[Event]:
        """
        Execute codex with streaming JSONL events.

        Accepts either an AgentInput object or a simple string query.

        Args:
            agent_input: AgentInput object or string query
            config_overrides: Optional runtime configuration overrides

        Yields:
            Event objects parsed from codex JSONL output
        """
        # Check prerequisites (codex CLI availability)
        self.check_prerequisites()

        # Normalize input (convert string to AgentInput if needed)
        normalized_input = self._normalize_input(agent_input)

        # Merge config with overrides
        effective_config = self._get_effective_config(config_overrides)

        # Build prompt from messages
        prompt = self._build_prompt_from_messages(normalized_input.messages)

        # Build command
        cmd = self._build_command(effective_config, prompt)

        # Execute and stream
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )

        try:
            for line in process.stdout:
                if not line.strip():
                    continue

                try:
                    event_data = json.loads(line)
                    event = self._parse_event(event_data)
                    if event:
                        yield event
                except json.JSONDecodeError:
                    # Log but continue on malformed JSON
                    continue

            process.wait()

            # Check for errors
            if process.returncode != 0:
                stderr = process.stderr.read()
                if stderr:
                    yield Event(
                        type=EventType.ERROR,
                        content=f"Codex execution failed: {stderr}",
                    )

        finally:
            # Ensure process is terminated
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)

    def _get_effective_config(
        self, overrides: Optional[AllAgentConfigs]
    ) -> CodexAgentConfig:
        """Get effective configuration with overrides applied."""
        if not self.config:
            # No base config, use overrides or defaults
            if overrides and isinstance(overrides.agent_config, CodexAgentConfig):
                return overrides.agent_config
            else:
                return CodexAgentConfig()

        effective = self.config
        if overrides:
            effective = self.config.merge_overrides(overrides)

        return effective.agent_config

    def _build_command(
        self, config: CodexAgentConfig, prompt: str
    ) -> List[str]:
        """
        Build codex command with config.

        Uses both:
        1. File-based config (~/.codex/config.toml) for MCP servers
        2. CLI args (-c flag) for runtime overrides
        """
        # Apply defaults for None values
        sandbox_mode = config.sandbox_mode or "read-only"
        codex_config = config.codex_config or {}

        cmd = [
            "codex",
            "exec",
            "--json",  # Output events as JSONL
            "--skip-git-repo-check",  # Allow running outside git repos
            "-s",
            sandbox_mode,  # Sandbox mode
        ]

        # Working directory
        working_dir = config.working_dir or os.getcwd()
        cmd.extend(["-C", working_dir])

        # Model (use -m flag for better compatibility)
        if config.model:
            cmd.extend(["-m", config.model])

        # Endpoint (for Azure, etc.)
        if config.endpoint:
            cmd.extend(["-c", f"api_endpoint={config.endpoint}"])

        # Additional codex_config (via -c flag)
        for key, value in codex_config.items():
            cmd.extend(["-c", f"{key}={value}"])

        # Prompt (last argument)
        cmd.append(prompt)

        return cmd

    def _build_prompt_from_messages(
        self, messages: List[Dict[str, Any]]
    ) -> str:
        """
        Build prompt from OpenAI-style messages.

        Args:
            messages: List of message dicts with role and content

        Returns:
            Formatted prompt string
        """
        if not messages:
            raise ValueError("Messages cannot be empty")

        # If only one user message, return directly
        if len(messages) == 1 and messages[0]["role"] == "user":
            return messages[0]["content"]

        # Multi-turn conversation: format as dialogue
        prompt_lines = ["Conversation history:"]

        for msg in messages:
            role = msg["role"]
            content = msg["content"]

            if role == "user":
                prompt_lines.append(f"User: {content}")
            elif role == "assistant":
                prompt_lines.append(f"Assistant: {content}")
            elif role == "system":
                # System messages go at the beginning
                prompt_lines.insert(1, f"System: {content}")
                prompt_lines.insert(2, "")  # Empty line

            prompt_lines.append("")  # Empty line for readability

        return "\n".join(prompt_lines)

    def _parse_event(self, event_data: Dict[str, Any]) -> Optional[Event]:
        """
        Parse codex JSONL event to Event object.

        Codex event types:
        - thread.started: {"type": "thread.started", "thread_id": "..."}
        - turn.started: {"type": "turn.started"}
        - item.completed: {"type": "item.completed", "item": {"type": "...", ...}}
        - turn.completed: {"type": "turn.completed", "usage": {...}}

        Item types within item.completed:
        - reasoning: {"type": "reasoning", "text": "..."}
        - command_execution: {"type": "command_execution", "command": "...", ...}
        - agent_message: {"type": "agent_message", "text": "..."}

        Args:
            event_data: Raw JSONL event from codex

        Returns:
            Parsed Event object or None if event should be skipped
        """
        event_type = event_data.get("type")

        if event_type == "thread.started":
            return ThreadStartedEvent(
                thread_id=event_data.get("thread_id", ""),
            )

        elif event_type == "turn.started":
            return TurnStartedEvent()

        elif event_type == "item.completed":
            item = event_data.get("item", {})
            item_type = item.get("type")

            if item_type == "reasoning":
                return ReasoningEvent(
                    content=item.get("text", ""),
                )

            elif item_type == "command_execution":
                return CommandExecutionEvent(
                    command=item.get("command", ""),
                    output=item.get("aggregated_output", ""),
                    exit_code=item.get("exit_code"),
                    metadata={"status": item.get("status")},
                )

            elif item_type == "agent_message":
                text = item.get("text", "")

                # Check if this is a skill invocation message
                # Pattern: "Using skill `skill-name`"
                skill_match = re.search(r"Using skill `([^`]+)`", text)
                if skill_match:
                    return SkillInvokedEvent(
                        skill_name=skill_match.group(1),
                        metadata={"text": text},
                    )

                # Regular agent message
                return MessageEvent(
                    content=text,
                )

        elif event_type == "turn.completed":
            return TurnCompletedEvent(
                usage=event_data.get("usage", {}),
            )

        return None


# ============================================================================
# Codex Configuration
# ============================================================================


def _configure_codex_auth(api_key: str, verbose: bool = False) -> None:
    """
    Configure Codex authentication by writing API key to ~/.codex/auth.json.

    Args:
        api_key: OpenAI API key
        verbose: Print configuration details
    """
    import json

    # Create .codex directory if it doesn't exist
    CODEX_DIR.mkdir(parents=True, exist_ok=True)

    # Write auth.json
    auth_config = {
        "OPENAI_API_KEY": api_key,
    }

    with open(CODEX_AUTH_PATH, "w") as f:
        json.dump(auth_config, f, indent=2)

    if verbose:
        print(f"✅ Configured API key in {CODEX_AUTH_PATH}")


# ============================================================================
# Skills Installation for Codex
# ============================================================================


def install_codex_skills(config: AllAgentConfigs, verbose: bool = False):
    """
    Install skills for Codex.

    This handles:
    1. Anthropic Skills: Copy to ~/.codex/skills/
    2. MCP Servers: Configure in ~/.codex/config.toml

    Args:
        config: Complete configuration with skills
        verbose: Print installation progress
    """
    # Create codex skills directory
    CODEX_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    installed_count = 0

    for skill in config.skills:
        if isinstance(skill, AnthropicSkillConfig):
            _install_anthropic_skill(skill, verbose=verbose)
            installed_count += 1

        elif isinstance(skill, (MCPStdioSkillConfig, MCPSSESkillConfig)):
            _configure_mcp_server(skill, verbose=verbose)
            # Verbose output is already printed in _configure_mcp_server

    if verbose:
        print(f"\n✅ Installed {installed_count} Anthropic skills to {CODEX_SKILLS_DIR}")


def _install_anthropic_skill(skill: AnthropicSkillConfig, verbose: bool = False):
    """Install Anthropic skill (copy to codex skills directory)."""
    source = Path(skill.path)
    if not source.exists():
        raise FileNotFoundError(f"Skill path not found: {source}")

    if not source.is_dir():
        raise ValueError(f"Skill path must be a directory: {source}")

    # Check if SKILL.md exists
    skill_md = source / "SKILL.md"
    if not skill_md.exists():
        raise ValueError(
            f"Invalid Anthropic skill: {source}. Must contain SKILL.md file"
        )

    # Target directory
    target = CODEX_SKILLS_DIR / source.name

    # Remove existing skill if present
    if target.exists():
        shutil.rmtree(target)

    # Copy skill to codex skills directory
    shutil.copytree(source, target)

    if verbose:
        print(f"✓ Installed skill: {source.name}")


def _configure_mcp_server(
    skill: Union[MCPStdioSkillConfig, MCPSSESkillConfig], verbose: bool = False
):
    """
    Configure MCP server in ~/.codex/config.toml.

    MCP servers need to be configured in the codex config file.
    Some options can only be set this way (e.g., tool_timeout_sec).
    """
    # Load or create config
    if CODEX_CONFIG_PATH.exists():
        with open(CODEX_CONFIG_PATH) as f:
            config = toml.load(f)
    else:
        config = {}

    # Ensure mcp_servers section exists
    if "mcp_servers" not in config:
        config["mcp_servers"] = {}

    # Build server config based on transport type
    server_config = {}

    if isinstance(skill, MCPStdioSkillConfig):
        # Generate server name from command
        server_name = skill.command.split()[0].replace("/", "-").replace("@", "")
        server_config["command"] = skill.command
        if skill.args:
            server_config["args"] = skill.args
        if skill.env:
            server_config["env"] = skill.env
    elif isinstance(skill, MCPSSESkillConfig):
        # Generate server name from URL
        server_name = skill.url.replace("://", "-").replace("/", "-").replace(":", "-")
        server_config["url"] = skill.url
    else:
        server_name = "unknown-server"

    # Merge additional config
    if skill.config:
        server_config.update(skill.config)

    # Add to config
    config["mcp_servers"][server_name] = server_config

    # Write config
    CODEX_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CODEX_CONFIG_PATH, "w") as f:
        toml.dump(config, f)

    if verbose:
        print(f"✓ Configured MCP server '{server_name}' in {CODEX_CONFIG_PATH}")
