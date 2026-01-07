"""Unified configuration structures for agentwrap."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union


# ============================================================================
# Skills Configuration
# ============================================================================


@dataclass
class MCPStdioSkillConfig:
    """
    MCP skill using stdio transport.

    Runs a command and communicates via standard input/output.
    """

    type: str = "mcp"  # Fixed type
    transport: str = "stdio"  # Fixed transport
    command: str = ""  # Command to run (required)
    args: List[str] = field(default_factory=list)  # Command arguments
    env: Dict[str, str] = field(default_factory=dict)  # Environment variables
    config: Optional[Dict[str, Any]] = None  # Additional MCP config

    def __post_init__(self):
        """Validate configuration."""
        if not self.command:
            raise ValueError("MCP stdio transport requires 'command' field")


@dataclass
class MCPSSESkillConfig:
    """
    MCP skill using SSE (Server-Sent Events) transport.

    Connects to a remote server via HTTP/SSE.
    """

    type: str = "mcp"  # Fixed type
    transport: str = "sse"  # Fixed transport
    url: str = ""  # Server URL (required)
    config: Optional[Dict[str, Any]] = None  # Additional MCP config

    def __post_init__(self):
        """Validate configuration."""
        if not self.url:
            raise ValueError("MCP sse transport requires 'url' field")


@dataclass
class AnthropicSkillConfig:
    """
    Anthropic Skill configuration (Markdown-based skills).

    These are skills defined with SKILL.md files.
    """

    type: str = "anthropic-skill"  # Fixed type
    path: str = ""  # Path to skill directory

    def __post_init__(self):
        """Validate configuration."""
        if not self.path:
            raise ValueError("Anthropic skill must have a 'path' field")


# Union type for MCP skills
MCPSkillConfig = Union[MCPStdioSkillConfig, MCPSSESkillConfig]

# Union type for all skills
SkillConfig = Union[MCPStdioSkillConfig, MCPSSESkillConfig, AnthropicSkillConfig]


# ============================================================================
# Agent Configuration
# ============================================================================


@dataclass
class CodexAgentConfig:
    """
    Configuration for CodexAgent.

    Includes API credentials, sandbox mode, and other codex-specific settings.
    """

    type: str = "codex-agent"  # Fixed type
    api_key: Optional[str] = None  # OpenAI API key (or from env)
    endpoint: Optional[str] = None  # Custom endpoint (for Azure, etc.)
    model: Optional[str] = None  # Model to use
    sandbox_mode: Optional[Literal["read-only", "workspace-write", "danger-full-access"]] = None  # Sandbox mode
    working_dir: Optional[str] = None  # Working directory
    # Additional codex config (passed via -c flag)
    codex_config: Optional[Dict[str, Any]] = None  # Extra config flags


# Union type for agent configs
AgentConfigType = CodexAgentConfig  # Add more agent types in future


# ============================================================================
# Unified Configuration
# ============================================================================


@dataclass
class AllAgentConfigs:
    """
    Complete configuration for agentwrap.

    This includes:
    - Agent configuration (type, credentials, settings)
    - Skills configuration (all skills to be loaded)
    """

    agent_config: AgentConfigType
    skills: List[SkillConfig] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AllAgentConfigs":
        """
        Create AllAgentConfigs from dictionary (e.g., from YAML).

        Args:
            data: Configuration dictionary

        Returns:
            AllAgentConfigs instance

        Example:
            ```python
            config = AllAgentConfigs.from_dict({
                "agent_config": {
                    "type": "codex-agent",
                    "api_key": "sk-...",
                },
                "skills": [
                    {
                        "type": "anthropic-skill",
                        "path": "./skills/my-skill"
                    },
                    {
                        "type": "mcp",
                        "transport": "stdio",
                        "command": "npx @server/filesystem",
                        "args": [],
                        "env": {"KEY": "value"}
                    }
                ]
            })
            ```
        """
        # Parse agent config
        agent_data = data.get("agent_config", {})
        agent_type = agent_data.get("type", "codex-agent")

        if agent_type == "codex-agent":
            agent_config = CodexAgentConfig(**agent_data)
        else:
            raise ValueError(f"Unknown agent type: {agent_type}")

        # Parse skills
        skills_data = data.get("skills", [])
        skills = []

        for skill_data in skills_data:
            skill_type = skill_data.get("type")

            if skill_type == "mcp":
                # Determine MCP transport type
                transport = skill_data.get("transport", "stdio")
                if transport == "stdio":
                    skills.append(MCPStdioSkillConfig(**skill_data))
                elif transport == "sse":
                    skills.append(MCPSSESkillConfig(**skill_data))
                else:
                    raise ValueError(
                        f"Unknown MCP transport: {transport}. Must be 'stdio' or 'sse'"
                    )
            elif skill_type == "anthropic-skill":
                skills.append(AnthropicSkillConfig(**skill_data))
            else:
                raise ValueError(f"Unknown skill type: {skill_type}")

        return cls(agent_config=agent_config, skills=skills)

    def merge_overrides(self, overrides: "AllAgentConfigs") -> "AllAgentConfigs":
        """
        Merge configuration overrides.

        This creates a new configuration with overrides applied.
        Used for runtime config overrides in agent.run().

        Args:
            overrides: Configuration overrides

        Returns:
            New AllAgentConfigs with overrides applied
        """
        # Deep copy current config
        import copy

        merged = copy.deepcopy(self)

        # Override agent config fields
        if isinstance(overrides.agent_config, CodexAgentConfig) and isinstance(
            merged.agent_config, CodexAgentConfig
        ):
            for field_name in [
                "api_key",
                "endpoint",
                "model",
                "sandbox_mode",
                "working_dir",
            ]:
                override_value = getattr(overrides.agent_config, field_name)
                if override_value is not None:
                    setattr(merged.agent_config, field_name, override_value)

            # Merge codex_config if present in overrides
            if overrides.agent_config.codex_config is not None:
                if merged.agent_config.codex_config is None:
                    merged.agent_config.codex_config = {}
                merged.agent_config.codex_config.update(
                    overrides.agent_config.codex_config
                )

        # Override skills (replace completely)
        if overrides.skills:
            merged.skills = overrides.skills

        return merged

    def print_summary(self):
        """Print configuration summary."""
        print("\n" + "=" * 60)
        print("Agent Configuration")
        print("=" * 60)

        # Agent config
        agent_config = self.agent_config
        print(f"\nAgent Type: {agent_config.type}")

        if isinstance(agent_config, CodexAgentConfig):
            sandbox = agent_config.sandbox_mode or "read-only (default)"
            print(f"Sandbox Mode: {sandbox}")
            if agent_config.working_dir:
                print(f"Working Dir: {agent_config.working_dir}")
            if agent_config.api_key:
                print(f"API Key: {agent_config.api_key[:10]}...")
            if agent_config.endpoint:
                print(f"Endpoint: {agent_config.endpoint}")

        # Skills
        print(f"\nSkills ({len(self.skills)}):")
        for skill in self.skills:
            if isinstance(skill, AnthropicSkillConfig):
                print(f"  - [{skill.type}] {skill.path}")
            elif isinstance(skill, MCPStdioSkillConfig):
                print(f"  - [{skill.type}/{skill.transport}] {skill.command}")
            elif isinstance(skill, MCPSSESkillConfig):
                print(f"  - [{skill.type}/{skill.transport}] {skill.url}")

        print("\n" + "=" * 60 + "\n")


# ============================================================================
# Agent Input
# ============================================================================


@dataclass
class AgentInput:
    """
    Input structure for agent.run().

    Follows OpenAI Completions API format for messages,
    with additional agentwrap-specific fields.
    """

    messages: List[Dict[str, Any]]  # OpenAI format messages
    # Future: function definitions, tool_choice, etc.
    functions: Optional[List[Dict[str, Any]]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None

    @classmethod
    def from_query(cls, query: str) -> "AgentInput":
        """
        Create AgentInput from a simple query string.

        This is a convenience method for simple use cases.

        Args:
            query: User query string

        Returns:
            AgentInput with single user message
        """
        return cls(messages=[{"role": "user", "content": query}])

    @classmethod
    def from_messages(cls, messages: List[Dict[str, Any]]) -> "AgentInput":
        """
        Create AgentInput from OpenAI-style messages.

        Args:
            messages: List of message dicts with role and content

        Returns:
            AgentInput instance
        """
        return cls(messages=messages)
