/**
 * Integration tests for CodexAgent.
 *
 * These tests require codex-cli to be available and OPENAI_API_KEY to be set.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, mkdir, rm, readFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CodexAgent } from '../../src/agents/codexAgent.js';
import { AgentInput, parseConfig } from '../../src/config.js';
import { EventType } from '../../src/events.js';

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const TEST_SKILLS_DIR = join(FIXTURES_DIR, 'skills');
const TEST_CONFIG_PATH = join(FIXTURES_DIR, 'configs', 'minimal.yaml');

// Skip these tests in CI or when API key is not available
const skipIntegration = !process.env.OPENAI_API_KEY;
const TEST_API_KEY = process.env.OPENAI_API_KEY || '';

describe.skipIf(skipIntegration)('CodexAgent Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = join(tmpdir(), `helio-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  it('should execute simple query', async () => {
    const agent = new CodexAgent();
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
      },
      skills: [],
    });

    const input = AgentInput.fromQuery('What is 2+2? Just give the number.');

    const events = [];
    for await (const event of agent.run(input)) {
      events.push(event);
    }

    // Should have at least some events
    expect(events.length).toBeGreaterThan(0);

    // Should have at least one message event
    const messageEvents = events.filter((e) => e.type === EventType.MESSAGE);
    expect(messageEvents.length).toBeGreaterThan(0);

    // The answer should mention "4"
    const messages = messageEvents.map((e: any) => e.content).join(' ');
    expect(messages).toContain('4');
  }, 30000); // 30 second timeout

  it('should handle multi-turn conversation', async () => {
    const agent = new CodexAgent();
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
      },
      skills: [],
    });

    const messages = [
      { role: 'user' as const, content: 'What is the capital of France?' },
      { role: 'assistant' as const, content: 'Paris' },
      { role: 'user' as const, content: 'What country is that in?' },
    ];

    const input = AgentInput.fromMessages(messages);

    const events = [];
    for await (const event of agent.run(input)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);

    const messageEvents = events.filter((e) => e.type === EventType.MESSAGE);
    expect(messageEvents.length).toBeGreaterThan(0);
  }, 30000);

  it('should execute with config overrides', async () => {
    const agent = new CodexAgent();
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
        sandboxMode: 'danger-full-access',
      },
      skills: [],
    });

    const input = AgentInput.fromQuery('What is 5+5?');

    // Override working dir
    const overrides = {
      agentConfig: {
        type: 'codex-agent' as const,
        workingDir: testDir,
      },
    };

    const events = [];
    for await (const event of agent.run(input, overrides)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle structured output', async () => {
    const agent = new CodexAgent();
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
      },
      skills: [],
    });

    const schema = {
      type: 'object',
      properties: {
        answer: { type: 'number' },
        explanation: { type: 'string' },
      },
      required: ['answer', 'explanation'],
    };

    const input = AgentInput.fromQuery(
      'What is 10 + 15? Provide answer and explanation.'
    );

    const result = await agent.runStructured(input, schema, {
      maxRetries: 2,
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect((result as any).answer).toBe(25);
    expect((result as any).explanation).toBeTruthy();
  }, 60000); // Longer timeout for retries

  it('should configure agent with test skills from config file', async () => {
    const agent = new CodexAgent();

    // Configure with test config file path and add API key via dict
    await agent.configure({
      agentConfig: {
        type: 'codex-agent',
        apiKey: TEST_API_KEY,
      },
      skills: [
        {
          type: 'anthropic-skill',
          path: join(TEST_SKILLS_DIR, 'echo_skill'),
        },
      ],
    }, { verbose: true });

    const config = agent.getConfig();
    expect(config).toBeDefined();
    expect(config!.skills.length).toBe(1);
    expect(config!.skills[0]?.type).toBe('anthropic-skill');

    // Verify skill was installed to ~/.codex/skills/
    const home = process.env.HOME || process.env.USERPROFILE;
    const codexSkillsDir = join(home!, '.codex', 'skills');
    const echoSkillPath = join(codexSkillsDir, 'echo_skill');

    try {
      await access(echoSkillPath);
      const skillMdPath = join(echoSkillPath, 'SKILL.md');
      await access(skillMdPath);
      // Skill installed successfully
      expect(true).toBe(true);
    } catch (err) {
      throw new Error(`Echo skill not installed at ${echoSkillPath}`);
    }
  }, 30000);

  it('should configure agent with test skills from dict', async () => {
    const agent = new CodexAgent();

    // Create config dict
    const configDict = {
      agent_config: {
        type: 'codex-agent' as const,
        apiKey: TEST_API_KEY,
      },
      skills: [
        {
          type: 'anthropic-skill' as const,
          path: join(TEST_SKILLS_DIR, 'echo_skill'),
        },
      ],
    };

    await agent.configure(configDict, { verbose: false });

    const config = agent.getConfig();
    expect(config).toBeDefined();
    expect(config!.skills.length).toBe(1);
  }, 30000);

  it('should run agent with echo skill', async () => {
    const agent = new CodexAgent();

    // Configure with echo skill
    const configDict = {
      agent_config: {
        type: 'codex-agent' as const,
        apiKey: TEST_API_KEY,
      },
      skills: [
        {
          type: 'anthropic-skill' as const,
          path: join(TEST_SKILLS_DIR, 'echo_skill'),
        },
      ],
    };

    await agent.configure(configDict, { verbose: false });

    // Create input that should trigger echo skill
    const input = AgentInput.fromQuery(
      'Use the echo skill to echo back this message: Hello from TypeScript integration test!'
    );

    // Run agent and collect events
    const events = [];
    const messages = [];

    for await (const event of agent.run(input)) {
      events.push(event);
      if (event.type === EventType.MESSAGE) {
        messages.push(event.content);
      }
    }

    // Verify we got events
    expect(events.length).toBeGreaterThan(0);

    // Verify we got messages
    expect(messages.length).toBeGreaterThan(0);

    // Verify skill was mentioned (agent should acknowledge using the skill)
    const fullOutput = messages.join(' ');
    expect(fullOutput.toLowerCase()).toContain('echo');
  }, 60000); // Longer timeout as this involves skill execution

  it('should handle config overrides at runtime', async () => {
    const agent = new CodexAgent();

    // Configure with base config
    const baseConfig = {
      agent_config: {
        type: 'codex-agent' as const,
        apiKey: TEST_API_KEY,
      },
      skills: [
        {
          type: 'anthropic-skill' as const,
          path: join(TEST_SKILLS_DIR, 'echo_skill'),
        },
      ],
    };

    await agent.configure(baseConfig, { verbose: false });

    // Create override config with different working dir
    const tmpDir = join(tmpdir(), `helio-override-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    const overrides = {
      agentConfig: {
        type: 'codex-agent' as const,
        workingDir: tmpDir,
      },
    };

    try {
      const input = AgentInput.fromQuery('What is 3+3?');

      const events = [];
      for await (const event of agent.run(input, overrides)) {
        events.push(event);
      }

      // Should complete successfully
      expect(events.length).toBeGreaterThan(0);
    } finally {
      // Cleanup
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('CodexAgent Unit', () => {
  it('should create agent instance', () => {
    const agent = new CodexAgent();
    expect(agent).toBeDefined();
  });

  it('should load test fixtures correctly', async () => {
    // Verify fixtures exist
    try {
      await access(TEST_CONFIG_PATH);
      await access(join(TEST_SKILLS_DIR, 'echo_skill', 'SKILL.md'));
      await access(join(TEST_SKILLS_DIR, 'echo_skill', 'scripts', 'echo.cjs'));
      await access(join(FIXTURES_DIR, 'mcp_servers', 'echo_server.cjs'));
    } catch (err) {
      throw new Error(`Test fixtures not found: ${(err as Error).message}`);
    }

    // Verify config can be parsed
    const yamlContent = await readFile(TEST_CONFIG_PATH, 'utf-8');
    expect(yamlContent).toContain('skills:');
    expect(yamlContent).toContain('type: anthropic');
    expect(yamlContent).toContain('path: ../skills/echo_skill');
  });

  it('should configure agent from dict', async () => {
    const agent = new CodexAgent();

    await agent.configure(
      {
        agentConfig: {
          type: 'codex-agent',
          sandboxMode: 'read-only',
        },
        skills: [],
      },
      { verbose: false }
    );

    const config = agent.getConfig();
    expect(config).toBeDefined();
    expect(config?.agentConfig.type).toBe('codex-agent');
  });

  it('should throw error for invalid agent type', async () => {
    const agent = new CodexAgent();

    await expect(
      agent.configure({
        agentConfig: {
          type: 'invalid-agent' as any,
        },
        skills: [],
      })
    ).rejects.toThrow();
  });
});
