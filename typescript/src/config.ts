/**
 * Configuration structures for agentwrap agents.
 *
 * This module defines all configuration types, mirroring the Python
 * implementation for API consistency across languages.
 */


// ============================================================================
// Skills Configuration
// ============================================================================

/**
 * MCP skill using stdio transport.
 */
export interface MCPStdioSkillConfig {
  type: 'mcp';
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  name?: string; // Optional custom name (if not provided, generated from command)
  config?: Record<string, unknown>;
}

/**
 * MCP skill using Streamable HTTP transport (2025-03-26 spec).
 * This is the current MCP transport protocol.
 */
export interface MCPStreamableHttpSkillConfig {
  type: 'mcp';
  transport: 'streamable-http';
  url: string;
  name?: string; // Optional custom name (if not provided, generated from URL)
  config?: Record<string, unknown>;
}

/**
 * MCP skill using legacy SSE transport (deprecated).
 * Kept for backwards compatibility.
 */
export interface MCPSSESkillConfig {
  type: 'mcp';
  transport: 'sse';
  url: string;
  name?: string;
  config?: Record<string, unknown>;
}

/**
 * Union type for MCP skills.
 */
export type MCPSkillConfig =
  | MCPStdioSkillConfig
  | MCPStreamableHttpSkillConfig
  | MCPSSESkillConfig;

/**
 * Anthropic Skill configuration (Markdown-based).
 */
export interface AnthropicSkillConfig {
  type: 'anthropic-skill';
  path: string;
}

/**
 * Union type for all skill configurations.
 */
export type SkillConfig =
  | MCPStdioSkillConfig
  | MCPStreamableHttpSkillConfig
  | MCPSSESkillConfig
  | AnthropicSkillConfig;

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Configuration for CodexAgent.
 */
export interface CodexAgentConfig {
  type: 'codex-agent';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  workingDir?: string;
  codexConfig?: Record<string, unknown>;
}

/**
 * Union type for agent configs (extensible for future agent types).
 */
export type AgentConfigType = CodexAgentConfig;

// ============================================================================
// Unified Configuration
// ============================================================================

/**
 * Complete configuration for agentwrap.
 */
export interface AllAgentConfigs {
  agentConfig: AgentConfigType;
  skills: SkillConfig[];
}

/**
 * Options for loading configuration.
 */
export interface ConfigLoadOptions {
  verbose?: boolean;
}

/**
 * Parse configuration from dictionary.
 */
export function parseConfig(data: unknown): AllAgentConfigs {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid config: must be an object');
  }

  const configData = data as Record<string, unknown>;

  // Parse agent config
  const agentData = (configData.agent_config || configData.agentConfig) as
    | Record<string, unknown>
    | undefined;

  if (!agentData) {
    throw new Error('Missing agent_config or agentConfig in configuration');
  }

  const agentType = agentData.type as string | undefined;
  if (agentType !== 'codex-agent') {
    throw new Error(`Unknown agent type: ${agentType ?? 'undefined'}`);
  }

  const agentConfig: CodexAgentConfig = {
    type: 'codex-agent',
    apiKey: agentData.api_key as string | undefined || agentData.apiKey as string | undefined,
    endpoint: agentData.endpoint as string | undefined,
    model: agentData.model as string | undefined,
    sandboxMode:
      (agentData.sandbox_mode as CodexAgentConfig['sandboxMode']) ||
      (agentData.sandboxMode as CodexAgentConfig['sandboxMode']),
    workingDir:
      (agentData.working_dir as string | undefined) ||
      (agentData.workingDir as string | undefined),
    codexConfig:
      (agentData.codex_config as Record<string, unknown> | undefined) ||
      (agentData.codexConfig as Record<string, unknown> | undefined),
  };

  // Parse skills
  const skillsData = (configData.skills as unknown[]) || [];
  const skills: SkillConfig[] = [];

  for (const skillData of skillsData) {
    if (!skillData || typeof skillData !== 'object') {
      continue;
    }

    const skill = skillData as Record<string, unknown>;
    const skillType = skill.type as string;

    if (skillType === 'mcp') {
      const transport = skill.transport as string;

      if (transport === 'stdio') {
        const command = skill.command as string;
        if (!command) {
          throw new Error("MCP stdio transport requires 'command' field");
        }

        skills.push({
          type: 'mcp',
          transport: 'stdio',
          command,
          args: skill.args as string[] | undefined,
          env: skill.env as Record<string, string> | undefined,
          config: skill.config as Record<string, unknown> | undefined,
        });
      } else if (transport === 'sse') {
        const url = skill.url as string;
        if (!url) {
          throw new Error("MCP sse transport requires 'url' field");
        }

        skills.push({
          type: 'mcp',
          transport: 'sse',
          url,
          config: skill.config as Record<string, unknown> | undefined,
        });
      } else {
        throw new Error(`Unknown MCP transport: ${transport}. Must be 'stdio' or 'sse'`);
      }
    } else if (skillType === 'anthropic-skill') {
      const path = skill.path as string;
      if (!path) {
        throw new Error("Anthropic skill must have a 'path' field");
      }

      skills.push({
        type: 'anthropic-skill',
        path,
      });
    } else {
      throw new Error(`Unknown skill type: ${skillType}`);
    }
  }

  return {
    agentConfig,
    skills,
  };
}

/**
 * Merge configuration overrides.
 */
export function mergeConfigs(
  base: AllAgentConfigs,
  overrides: Partial<AllAgentConfigs>
): AllAgentConfigs {
  const merged: AllAgentConfigs = {
    agentConfig: { ...base.agentConfig },
    skills: [...base.skills],
  };

  // Merge agent config
  if (overrides.agentConfig) {
    Object.assign(merged.agentConfig, overrides.agentConfig);
  }

  // Override skills (replace completely if provided)
  if (overrides.skills && overrides.skills.length > 0) {
    merged.skills = [...overrides.skills];
  }

  return merged;
}

/**
 * Print configuration summary.
 */
export function printConfigSummary(config: AllAgentConfigs): void {
  console.log('\n' + '='.repeat(60));
  console.log('Agent Configuration');
  console.log('='.repeat(60));

  const agentConfig = config.agentConfig;
  console.log(`\nAgent Type: ${agentConfig.type}`);

  if (agentConfig.type === 'codex-agent') {
    const sandbox = agentConfig.sandboxMode || 'read-only (default)';
    console.log(`Sandbox Mode: ${sandbox}`);
    if (agentConfig.workingDir) {
      console.log(`Working Dir: ${agentConfig.workingDir}`);
    }
    if (agentConfig.apiKey) {
      console.log(`API Key: ${agentConfig.apiKey.substring(0, 10)}...`);
    }
    if (agentConfig.endpoint) {
      console.log(`Endpoint: ${agentConfig.endpoint}`);
    }
  }

  console.log(`\nSkills (${config.skills.length}):`);
  for (const skill of config.skills) {
    if (skill.type === 'anthropic-skill') {
      console.log(`  - [${skill.type}] ${skill.path}`);
    } else if (skill.type === 'mcp' && skill.transport === 'stdio') {
      console.log(`  - [${skill.type}/${skill.transport}] ${skill.command}`);
    } else if (skill.type === 'mcp' && skill.transport === 'sse') {
      console.log(`  - [${skill.type}/${skill.transport}] ${skill.url}`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// ============================================================================
// Agent Input
// ============================================================================

/**
 * Message in OpenAI format.
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Input structure for agent.run().
 */
export interface AgentInput {
  messages: Message[];
  functions?: unknown[];
  temperature?: number;
  maxTokens?: number;
}

