"""CLI tool for agentwrap."""

from pathlib import Path

import click

from ..config import AgentInput, AllAgentConfigs
from ..agents import CodexAgent
from ..configure import config_agent
from .formatting import format_event


@click.group()
@click.version_option()
def cli():
    """
    AgentWrap - Agent-First AI Framework

    Let AI agents make decisions, not code.
    """
    pass


@cli.command()
@click.argument("query")
@click.option(
    "--config",
    "-c",
    type=click.Path(exists=True),
    help="Config file (agentwrap.yaml)",
)
@click.option(
    "--working-dir",
    "-C",
    type=click.Path(exists=True, file_okay=False),
    help="Working directory",
)
@click.option(
    "--verbose",
    "-v",
    is_flag=True,
    help="Show verbose output (reasoning, commands, etc.)",
)
def run(query: str, config: str, working_dir: str, verbose: bool):
    """
    Execute a query with agent.

    Examples:

        agentwrap run "What is 2+2?"

        agentwrap run "Analyze the latest AI trends" -c agentwrap.yaml

        agentwrap run "Search for Python files" -C /path/to/project -v
    """
    # Load and configure agent if config provided
    configured = None
    if config:
        try:
            configured = config_agent(config, verbose=verbose)
            if verbose:
                click.echo()  # Empty line for readability
        except Exception as e:
            click.echo(f"Error loading config: {e}", err=True)
            raise click.Abort()

    # Apply working_dir override if provided
    if working_dir and configured:
        override = AllAgentConfigs.from_dict({
            "agent_config": {
                "type": "codex-agent",
                "working_dir": working_dir
            },
            "skills": []
        })
        configured = configured.merge_overrides(override)
    elif working_dir and not configured:
        # No config, just working dir
        configured = AllAgentConfigs.from_dict({
            "agent_config": {
                "type": "codex-agent",
                "working_dir": working_dir
            },
            "skills": []
        })

    # Create agent
    agent = CodexAgent(configured)

    # Create input from query
    agent_input = AgentInput.from_query(query)

    # Execute query and stream output
    try:
        for event in agent.run(agent_input):
            formatted = format_event(event, verbose=verbose)
            if formatted:
                click.echo(formatted, nl=False)
    except KeyboardInterrupt:
        click.echo("\n\nInterrupted by user", err=True)
        raise click.Abort()
    except Exception as e:
        click.echo(f"\nError: {e}", err=True)
        raise click.Abort()

    click.echo()  # Final newline


@cli.command()
@click.argument("path", type=click.Path())
def init(path: str):
    """
    Initialize a new agentwrap project.

    This creates a basic project structure with a agentwrap.yaml
    configuration file and a skills directory.

    Examples:

        agentwrap init my-project

        agentwrap init ./current-dir
    """
    project_dir = Path(path)

    # Create project directory
    try:
        project_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        click.echo(f"Error creating directory: {e}", err=True)
        raise click.Abort()

    # Create skills directory
    skills_dir = project_dir / "skills"
    skills_dir.mkdir(exist_ok=True)

    # Create agentwrap.yaml
    config_file = project_dir / "agentwrap.yaml"
    if config_file.exists():
        click.echo(f"Warning: {config_file} already exists, skipping", err=True)
    else:
        config_content = """# AgentWrap Configuration

agent_config:
  type: codex-agent
  # Optional: Customize agent settings
  # sandbox_mode: default
  # working_dir: /path/to/project
  # api_key: sk-...

skills:
  # Anthropic Skills (Markdown-based)
  # - type: anthropic-skill
  #   path: ./skills/my-skill

  # MCP stdio tools
  # - type: mcp
  #   transport: stdio
  #   command: npx @modelcontextprotocol/server-filesystem
  #   args: ["--root", "/data"]

  # MCP SSE tools
  # - type: mcp
  #   transport: sse
  #   url: http://localhost:3000/mcp
"""
        config_file.write_text(config_content)

    click.echo(f"✓ Initialized project at {project_dir}")
    click.echo(f"  Edit {config_file} to add skills")
    click.echo(f"  Place your skills in {skills_dir}/")


@cli.command()
@click.argument("config", type=click.Path(exists=True))
@click.option("--verbose", "-v", is_flag=True, help="Show installation details")
def install(config: str, verbose: bool):
    """
    Install skills from config file.

    This reads the agentwrap.yaml configuration and installs
    all defined skills to ~/.codex/skills/ and ~/.codex/config.toml.

    Examples:

        agentwrap install agentwrap.yaml

        agentwrap install agentwrap.yaml -v
    """
    try:
        configured = config_agent(config, verbose=verbose)

        if not verbose:
            click.echo(f"✓ Configured agent with {len(configured.skills)} skills")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@cli.command()
def skills():
    """
    List all installed skills.

    Shows skills installed in ~/.codex/skills/ directory.
    """
    from ..agents.codex_agent import CODEX_SKILLS_DIR

    if not CODEX_SKILLS_DIR.exists():
        click.echo("No skills installed.")
        click.echo("Install skills with: agentwrap install agentwrap.yaml")
        return

    installed = [
        d.name for d in CODEX_SKILLS_DIR.iterdir()
        if d.is_dir() and not d.name.startswith('.')
    ]

    if not installed:
        click.echo("No skills installed.")
        click.echo("Install skills with: agentwrap install agentwrap.yaml")
        return

    click.echo(f"Installed skills ({len(installed)}):")
    for skill in sorted(installed):
        click.echo(f"  - {skill}")


if __name__ == "__main__":
    cli()
