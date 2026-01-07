/**
 * Unit tests for configuration parsing and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  parseConfig,
  mergeConfigs,
  AgentInput,
  type AllAgentConfigs,
  type MCPStdioSkillConfig,
  type MCPSSESkillConfig,
  type AnthropicSkillConfig,
} from '../../src/config.js';

describe('Config', () => {
  describe('parseConfig', () => {
    it('should parse basic codex agent config', () => {
      const data = {
        agent_config: {
          type: 'codex-agent',
          api_key: 'sk-test123',
        },
        skills: [],
      };

      const config = parseConfig(data);

      expect(config.agentConfig.type).toBe('codex-agent');
      expect(config.agentConfig.apiKey).toBe('sk-test123');
      expect(config.skills).toEqual([]);
    });

    it('should parse MCP stdio skill', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'mcp',
            transport: 'stdio',
            command: 'npx server',
            args: ['--root', '/data'],
            env: { DEBUG: '1' },
          },
        ],
      };

      const config = parseConfig(data);

      expect(config.skills.length).toBe(1);
      const skill = config.skills[0] as MCPStdioSkillConfig;
      expect(skill.type).toBe('mcp');
      expect(skill.transport).toBe('stdio');
      expect(skill.command).toBe('npx server');
      expect(skill.args).toEqual(['--root', '/data']);
      expect(skill.env).toEqual({ DEBUG: '1' });
    });

    it('should parse MCP SSE skill', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'mcp',
            transport: 'sse',
            url: 'http://localhost:3000/mcp',
          },
        ],
      };

      const config = parseConfig(data);

      expect(config.skills.length).toBe(1);
      const skill = config.skills[0] as MCPSSESkillConfig;
      expect(skill.type).toBe('mcp');
      expect(skill.transport).toBe('sse');
      expect(skill.url).toBe('http://localhost:3000/mcp');
    });

    it('should parse Anthropic skill', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'anthropic-skill',
            path: './skills/echo-skill',
          },
        ],
      };

      const config = parseConfig(data);

      expect(config.skills.length).toBe(1);
      const skill = config.skills[0] as AnthropicSkillConfig;
      expect(skill.type).toBe('anthropic-skill');
      expect(skill.path).toBe('./skills/echo-skill');
    });

    it('should throw error for missing agent_config', () => {
      const data = { skills: [] };

      expect(() => parseConfig(data)).toThrow('Missing agent_config');
    });

    it('should throw error for unknown agent type', () => {
      const data = {
        agent_config: { type: 'unknown-agent' },
        skills: [],
      };

      expect(() => parseConfig(data)).toThrow('Unknown agent type');
    });

    it('should throw error for MCP stdio without command', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'mcp',
            transport: 'stdio',
            // Missing command
          },
        ],
      };

      expect(() => parseConfig(data)).toThrow("MCP stdio transport requires 'command' field");
    });

    it('should throw error for MCP sse without url', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'mcp',
            transport: 'sse',
            // Missing url
          },
        ],
      };

      expect(() => parseConfig(data)).toThrow("MCP sse transport requires 'url' field");
    });

    it('should throw error for unknown MCP transport', () => {
      const data = {
        agent_config: { type: 'codex-agent' },
        skills: [
          {
            type: 'mcp',
            transport: 'websocket',
            url: 'ws://localhost',
          },
        ],
      };

      expect(() => parseConfig(data)).toThrow("Unknown MCP transport");
    });
  });

  describe('mergeConfigs', () => {
    it('should merge agent config fields', () => {
      const base: AllAgentConfigs = {
        agentConfig: {
          type: 'codex-agent',
          apiKey: 'sk-base',
          sandboxMode: 'workspace-write',
        },
        skills: [],
      };

      const overrides: Partial<AllAgentConfigs> = {
        agentConfig: {
          type: 'codex-agent',
          workingDir: '/tmp',
        },
      };

      const merged = mergeConfigs(base, overrides);

      expect(merged.agentConfig.apiKey).toBe('sk-base');
      expect(merged.agentConfig.sandboxMode).toBe('workspace-write');
      expect(merged.agentConfig.workingDir).toBe('/tmp');
    });

    it('should replace skills when provided', () => {
      const base: AllAgentConfigs = {
        agentConfig: { type: 'codex-agent' },
        skills: [
          {
            type: 'anthropic-skill',
            path: './skill1',
          },
        ],
      };

      const overrides: Partial<AllAgentConfigs> = {
        skills: [
          {
            type: 'anthropic-skill',
            path: './skill2',
          },
        ],
      };

      const merged = mergeConfigs(base, overrides);

      expect(merged.skills.length).toBe(1);
      expect((merged.skills[0] as AnthropicSkillConfig).path).toBe('./skill2');
    });

    it('should preserve base skills when overrides has empty skills', () => {
      const base: AllAgentConfigs = {
        agentConfig: { type: 'codex-agent' },
        skills: [
          {
            type: 'anthropic-skill',
            path: './skill1',
          },
        ],
      };

      const overrides: Partial<AllAgentConfigs> = {
        agentConfig: {
          type: 'codex-agent',
          workingDir: '/tmp',
        },
        skills: [],
      };

      const merged = mergeConfigs(base, overrides);

      // Empty array should NOT replace (preserved from base)
      expect(merged.skills.length).toBe(1);
      expect((merged.skills[0] as AnthropicSkillConfig).path).toBe('./skill1');
    });
  });

  describe('AgentInput', () => {
    it('should create input from query string', () => {
      const input: AgentInput = {
        messages: [{ role: 'user', content: 'Test query' }],
      };

      expect(input.messages).toHaveLength(1);
      expect(input.messages[0]?.role).toBe('user');
      expect(input.messages[0]?.content).toBe('Test query');
    });

    it('should create input from messages array', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
        { role: 'user' as const, content: 'How are you?' },
      ];

      const input: AgentInput = { messages };

      expect(input.messages).toHaveLength(3);
      expect(input.messages).toEqual(messages);
    });
  });
});
