/**
 * CodexAgent implementation using OpenAI Codex CLI.
 *
 * This wraps the codex-cli tool and provides streaming event-based
 * execution with skills support, mirroring the Python implementation.
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { copy } from 'fs-extra';
import { homedir } from 'os';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';

import { BaseAgent, type RunOptions } from '../agent.js';
import type { Prompts } from '../prompts.js';
import type {
  Event,
  ThreadStartedEvent,
  TurnStartedEvent,
  ReasoningEvent,
  CommandExecutionEvent,
  SkillInvokedEvent,
  MessageEvent,
  TurnCompletedEvent,
  ErrorEvent,
} from '../events.js';
import { EventType } from '../events.js';
import type {
  AllAgentConfigs,
  AnthropicSkillConfig,
  MCPStdioSkillConfig,
  MCPSSESkillConfig,
  SkillConfig,
} from '../config.js';
import {
  parseConfig,
  printConfigSummary,
} from '../config.js';

// Codex configuration paths
const CODEX_DIR = resolve(homedir(), '.codex');
const CODEX_SKILLS_DIR = resolve(CODEX_DIR, 'skills');
const CODEX_CONFIG_PATH = resolve(CODEX_DIR, 'config.toml');
const CODEX_AUTH_PATH = resolve(CODEX_DIR, 'auth.json');

/**
 * CodexAgent - Agent implementation using OpenAI Codex CLI.
 */
export class CodexAgent extends BaseAgent {
  constructor(prompts?: Prompts) {
    super(prompts);
  }

  /**
   * Configure agent with skills and settings.
   *
   * This method loads configuration and installs skills.
   */
  async configure(
    config: AllAgentConfigs | Record<string, unknown>,
    options: { verbose?: boolean } = {}
  ): Promise<CodexAgent> {
    const { verbose = false } = options;

    // Parse config
    let allConfigs: AllAgentConfigs;

    if ('agentConfig' in config && 'skills' in config) {
      // Already parsed AllAgentConfigs
      allConfigs = config as AllAgentConfigs;
    } else {
      // Parse from dict
      allConfigs = parseConfig(config);
    }

    // Validate agent type
    if (allConfigs.agentConfig.type !== 'codex-agent') {
      throw new Error(
        `CodexAgent requires CodexAgentConfig, got ${String(allConfigs.agentConfig.type)}`
      );
    }

    // Configure API key if provided or from environment variable
    const agentConfig = allConfigs.agentConfig;
    const apiKey = agentConfig.apiKey || process.env.OPENAI_API_KEY;
    if (apiKey) {
      await configureCodexAuth(apiKey, verbose);
    }

    // Install skills
    await installCodexSkills(allConfigs, verbose);

    // Store config
    this.config = allConfigs;

    // Print config summary if verbose
    if (verbose) {
      printConfigSummary(allConfigs);
    }

    return this;
  }

  async *runRaw(
    prompt: string,
    options?: RunOptions
  ): AsyncIterable<Event> {
    const { configOverrides } = options || {};
    // Merge config with overrides
    const effectiveConfig = this.getEffectiveConfig(configOverrides);

    // Build command with effective config
    const cmd = this.buildCommand(effectiveConfig, prompt);

    // Debug: log command
    console.log(`[CodexAgent] Executing command:`, cmd.join(' '));

    // Execute and stream
    const process = spawn(cmd[0]!, cmd.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      yield* this.streamEvents(process);
    } finally {
      // Ensure process is terminated
      if (process.exitCode === null) {
        process.kill();
      }
    }
  }

  /**
   * Execute codex with streaming JSONL events.
   *
   * Accepts AgentInput object, Message array, or simple string query.
   */
  async *run(
    agentInput: Parameters<BaseAgent['run']>[0],
    options?: RunOptions
  ): AsyncIterable<Event> {
    const { configOverrides } = options || {};

    // Normalize input (convert string/Message[] to AgentInput if needed)
    const normalizedInput = this.normalizeInput(agentInput);
    
    // Build prompt from messages
    const prompt = this.buildPromptFromMessages(normalizedInput.messages);
    // Execute raw run with prompt
    yield* this.runRaw(prompt, { configOverrides });
  }

  /**
   * Get effective configuration with overrides applied.
   */
  private getEffectiveConfig(
    overrides?: Partial<AllAgentConfigs>
  ): AllAgentConfigs {
    if (!this.config) {
      // No base config, use overrides or defaults
      const agentConfig =
        overrides?.agentConfig && overrides.agentConfig.type === 'codex-agent'
          ? (overrides.agentConfig)
          : { type: 'codex-agent' as const };
      return {
        agentConfig,
        skills: overrides?.skills || [],
      };
    }

    if (overrides) {
      return {
        agentConfig: { ...this.config.agentConfig, ...overrides.agentConfig },
        skills: overrides.skills || this.config.skills,
      };
    }

    return this.config;
  }

  /**
   * Build codex command with config.
   *
   * All MCP servers from config.skills are added via -c flags.
   * This is redundant with toml config but ensures runtime config takes precedence.
   */
  private buildCommand(
    config: AllAgentConfigs,
    prompt: string
  ): string[] {
    const agentConfig = config.agentConfig;
    const sandboxMode = agentConfig.sandboxMode || 'read-only';
    const codexConfig = agentConfig.codexConfig || {};

    const cmd = [
      this.getCodexPath(),
      'exec',
      '--json', // Output events as JSONL
      '--skip-git-repo-check', // Allow running outside git repos
      '-s',
      sandboxMode, // Sandbox mode
    ];

    // Working directory
    const workingDir = agentConfig.workingDir || process.cwd();
    cmd.push('-C', workingDir);

    // Model (use -m flag for better compatibility)
    if (agentConfig.model) {
      cmd.push('-m', agentConfig.model);
    }

    // Endpoint (for Azure, etc.)
    if (agentConfig.endpoint) {
      cmd.push('-c', `api_endpoint=${agentConfig.endpoint}`);
    }

    // Additional codex_config (via -c flag)
    for (const [key, value] of Object.entries(codexConfig)) {
      cmd.push('-c', `${key}=${String(value)}`);
    }

    // MCP servers: Add all MCP skills via -c flags
    // This allows runtime config to override toml config
    for (const skill of config.skills) {
      if (skill.type === 'mcp') {
        const serverName = skill.name || this.generateMcpServerName(skill);

        // Only streamable-http and sse can be configured via -c flags
        // stdio requires command/args which can't be passed via -c
        if (skill.transport === 'streamable-http' || skill.transport === 'sse') {
          cmd.push('-c', `mcp_servers.${serverName}.url=${skill.url}`);
        }
      }
    }

    // Prompt (last argument)
    cmd.push(prompt);

    return cmd;
  }

  /**
   * Generate MCP server name from skill config.
   * Only alphanumeric characters allowed in server name.
   */
  private generateMcpServerName(skill: SkillConfig): string {
    if (skill.type !== 'mcp') {
      throw new Error('Can only generate name for MCP skills');
    }

    if (skill.transport === 'stdio') {
      const cmdBase = skill.command.split(' ')[0]!.replace(/[^a-zA-Z0-9]/g, '_');
      return `mcp_stdio_${cmdBase}`;
    } else {
      // streamable-http or sse
      try {
        const urlObj = new URL(skill.url);
        const host = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        const port = urlObj.port || '80';
        return `mcp_http_${host}_${port}`;
      } catch {
        // Fallback for invalid URLs
        return `mcp_http_${skill.url.replace(/[^a-zA-Z0-9]/g, '_')}`;
      }
    }
  }

  /**
   * Get path to codex binary (from node_modules or global).
   */
  private getCodexPath(): string {
    // Try to use codex from @openai/codex dependency
    try {
      // Use require.resolve to find @openai/codex package
      // This works correctly whether agentwrap is installed or in development
      const require = createRequire(import.meta.url);
      const codexPkgPath = require.resolve('@openai/codex/package.json');
      const codexBinPath = codexPkgPath.replace('package.json', 'bin/codex.js');
      return codexBinPath;
    } catch {
      // Fallback to codex in PATH
      return 'codex';
    }
  }

  /**
   * Build prompt from OpenAI-style messages.
   */
  private buildPromptFromMessages(
    messages: Array<{ role: string; content: string }>
  ): string {
    if (messages.length === 0) {
      throw new Error('Messages cannot be empty');
    }

    // If only one user message, return directly
    if (messages.length === 1 && messages[0]!.role === 'user') {
      return messages[0]!.content;
    }

    // Multi-turn conversation: format as dialogue
    const promptLines: string[] = ['Conversation history:'];

    for (const msg of messages) {
      const { role, content } = msg;

      if (role === 'user') {
        promptLines.push(`User: ${content}`);
      } else if (role === 'assistant') {
        promptLines.push(`Assistant: ${content}`);
      } else if (role === 'system') {
        // System messages go at the beginning
        promptLines.splice(1, 0, `System: ${content}`, '');
      }

      promptLines.push(''); // Empty line for readability
    }

    return promptLines.join('\n');
  }

  /**
   * Stream events from codex process.
   */
  private async *streamEvents(process: ChildProcess): AsyncIterable<Event> {
    const stdout = process.stdout;
    if (!stdout) {
      throw new Error('Failed to get stdout from codex process');
    }

    let buffer = '';

    // Process stdout line by line
    for await (const chunk of stdout) {
      const chunkStr = chunk instanceof Buffer ? chunk.toString() : String(chunk);
      buffer += chunkStr;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const eventData = JSON.parse(line) as Record<string, unknown>;
          const event = this.parseEvent(eventData);
          if (event) {
            yield event;
          }
        } catch {
          // Ignore malformed JSON
          continue;
        }
      }
    }

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      process.on('exit', () => resolve());
    });

    // Check for errors
    if (process.exitCode !== 0 && process.stderr) {
      const stderr = await readStream(process.stderr);
      if (stderr) {
        yield {
          type: EventType.ERROR,
          content: `Codex execution failed: ${stderr}`,
        } as ErrorEvent;
      }
    }
  }

  /**
   * Parse codex JSONL event to Event object.
   */
  private parseEvent(eventData: Record<string, unknown>): Event | null {
    const eventType = eventData.type as string;

    switch (eventType) {
      case 'thread.started':
        return {
          type: EventType.THREAD_STARTED,
          threadId: (eventData.thread_id as string) || '',
        } as ThreadStartedEvent;

      case 'turn.started':
        return {
          type: EventType.TURN_STARTED,
        } as TurnStartedEvent;

      case 'item.completed': {
        const item = (eventData.item as Record<string, unknown>) || {};
        const itemType = item.type as string;

        if (itemType === 'reasoning') {
          return {
            type: EventType.REASONING,
            content: (item.text as string) || '',
          } as ReasoningEvent;
        }

        if (itemType === 'command_execution') {
          return {
            type: EventType.COMMAND_EXECUTION,
            command: (item.command as string) || '',
            output: (item.aggregated_output as string) || '',
            exitCode: item.exit_code as number | undefined,
            metadata: { status: item.status },
          } as CommandExecutionEvent;
        }

        if (itemType === 'agent_message') {
          const text = (item.text as string) || '';

          // Check if this is a skill invocation message
          const skillMatch = text.match(/Using skill `([^`]+)`/);
          if (skillMatch) {
            return {
              type: EventType.SKILL_INVOKED,
              skillName: skillMatch[1]!,
              metadata: { text },
            } as SkillInvokedEvent;
          }

          // Regular agent message
          return {
            type: EventType.MESSAGE,
            content: text,
          } as MessageEvent;
        }

        return null;
      }

      case 'turn.completed':
        return {
          type: EventType.TURN_COMPLETED,
          usage: eventData.usage as Record<string, unknown> | undefined,
        } as TurnCompletedEvent;

      default:
        return null;
    }
  }
}

// ============================================================================
// Codex Configuration
// ============================================================================

/**
 * Configure Codex authentication by writing API key to ~/.codex/auth.json.
 */
async function configureCodexAuth(
  apiKey: string,
  verbose: boolean = false
): Promise<void> {
  // Create .codex directory if it doesn't exist
  await mkdir(CODEX_DIR, { recursive: true });

  // Write auth.json
  const authConfig = {
    OPENAI_API_KEY: apiKey,
  };

  await writeFile(CODEX_AUTH_PATH, JSON.stringify(authConfig, null, 2), 'utf-8');

  if (verbose) {
    console.log(`✅ Configured API key in ${CODEX_AUTH_PATH}`);
  }
}

// ============================================================================
// Skills Installation for Codex
// ============================================================================

/**
 * Install skills for Codex.
 *
 * - Anthropic skills: Copy to ~/.codex/skills/
 * - MCP skills: Write to ~/.codex/config.toml (all transports)
 */
async function installCodexSkills(
  config: AllAgentConfigs,
  verbose: boolean = false
): Promise<void> {
  // Create codex skills directory
  await mkdir(CODEX_SKILLS_DIR, { recursive: true });

  let anthropicCount = 0;
  let mcpCount = 0;

  for (const skill of config.skills) {
    if (skill.type === 'anthropic-skill') {
      await installAnthropicSkill(skill, verbose);
      anthropicCount++;
    } else if (skill.type === 'mcp') {
      // All MCP skills (stdio, sse, streamable-http) are written to config file
      await configureMCPServer(skill, verbose);
      mcpCount++;
    }
  }

  if (verbose) {
    if (anthropicCount > 0) {
      console.log(`\n✅ Installed ${anthropicCount} Anthropic skills to ${CODEX_SKILLS_DIR}`);
    }
    if (mcpCount > 0) {
      console.log(`✅ Configured ${mcpCount} MCP servers in ${CODEX_CONFIG_PATH}`);
    }
  }
}

/**
 * Install Anthropic skill (copy to codex skills directory).
 */
async function installAnthropicSkill(
  skill: AnthropicSkillConfig,
  verbose: boolean
): Promise<void> {
  const sourcePath = resolve(skill.path);

  // Check if source exists
  try {
    await access(sourcePath);
  } catch {
    throw new Error(`Skill path not found: ${sourcePath}`);
  }

  // Check if SKILL.md exists
  const skillMdPath = resolve(sourcePath, 'SKILL.md');
  try {
    await access(skillMdPath);
  } catch {
    throw new Error(
      `Invalid Anthropic skill: ${sourcePath}. Must contain SKILL.md file`
    );
  }

  // Target directory
  const skillName = sourcePath.split('/').pop()!;
  const targetPath = resolve(CODEX_SKILLS_DIR, skillName);

  // Copy entire skill directory recursively
  await copy(sourcePath, targetPath, { overwrite: true });

  if (verbose) {
    console.log(`✓ Installed skill: ${skillName}`);
  }
}

/**
 * Configure MCP server in ~/.codex/config.toml.
 *
 * Uses skill.name if provided, otherwise generates a simple name from:
 * - stdio: command basename
 * - http/sse: hostname and port
 *
 * Does NOT generate random strings - those are only for temporary
 * OpenAI endpoint MCP servers.
 */
async function configureMCPServer(
  skill: MCPStdioSkillConfig | MCPSSESkillConfig | SkillConfig,
  verbose: boolean
): Promise<void> {
  if (skill.type !== 'mcp') {
    throw new Error('Can only configure MCP skills');
  }

  // Load or create config
  let config: Record<string, unknown>;

  try {
    const content = await readFile(CODEX_CONFIG_PATH, 'utf-8');
    config = parseToml(content) as Record<string, unknown>;
  } catch {
    config = {};
  }

  // Ensure mcp_servers section exists
  if (!config.mcp_servers) {
    config.mcp_servers = {};
  }

  const mcpServers = config.mcp_servers as Record<string, unknown>;

  // Determine server name (use configured name or generate simple one)
  let serverName: string;
  if (skill.name) {
    serverName = skill.name;
  } else {
    // Generate simple name based on transport type
    if (skill.transport === 'stdio') {
      const cmdBase = skill.command.split(' ')[0]!.replace(/[^a-zA-Z0-9]/g, '_');
      serverName = `mcp_stdio_${cmdBase}`;
    } else {
      // streamable-http or sse
      try {
        const urlObj = new URL(skill.url);
        const host = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        const port = urlObj.port || '80';
        serverName = `mcp_http_${host}_${port}`;
      } catch {
        serverName = `mcp_http_${skill.url.replace(/[^a-zA-Z0-9]/g, '_')}`;
      }
    }
  }

  // Build server config based on transport type
  const serverConfig: Record<string, unknown> = {};

  if (skill.transport === 'stdio') {
    serverConfig.command = skill.command;
    if (skill.args) {
      serverConfig.args = skill.args;
    }
    if (skill.env) {
      serverConfig.env = skill.env;
    }
  } else {
    // streamable-http or sse
    serverConfig.url = skill.url;
  }

  // Merge additional config
  if (skill.config) {
    Object.assign(serverConfig, skill.config);
  }

  // Add to config
  mcpServers[serverName] = serverConfig;

  // Write config
  await mkdir(dirname(CODEX_CONFIG_PATH), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
  await writeFile(CODEX_CONFIG_PATH, stringifyToml(config as any), 'utf-8');

  if (verbose) {
    console.log(`  ✓ MCP server '${serverName}' (${skill.transport})`);
  }
}

/**
 * Helper to read entire stream.
 */
async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
