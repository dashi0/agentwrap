"""
Integration tests for config merge behavior.

These tests verify that config_agent properly preserves unspecified fields
when merging configurations.
"""

import pytest

from agentwrap.config import AllAgentConfigs


def test_config_merge_preserves_unspecified_fields():
    """
    Test that merge_overrides preserves base config fields when not specified in overrides.

    Verifies that:
    1. Unspecified fields in override retain base config values
    2. Specified fields in override update correctly
    3. None values in override don't overwrite base config
    """
    # Create base config with explicit values
    base_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "sandbox_mode": "default",
            "api_key": "sk-base-key",
            "working_dir": "/base/dir",
            "model": "gpt-4",
        },
        "skills": []
    })

    # Create override with only working_dir specified
    override_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "working_dir": "/override/dir",
        },
        "skills": []
    })

    # Merge configs
    merged = base_config.merge_overrides(override_config)

    # Verify unspecified fields are preserved from base
    assert merged.agent_config.sandbox_mode == "default", \
        "sandbox_mode should be preserved from base config"
    assert merged.agent_config.api_key == "sk-base-key", \
        "api_key should be preserved from base config"
    assert merged.agent_config.model == "gpt-4", \
        "model should be preserved from base config"

    # Verify specified field is overridden
    assert merged.agent_config.working_dir == "/override/dir", \
        "working_dir should be updated from override"


def test_config_merge_with_none_base_values():
    """
    Test merge behavior when base config has None values.

    Verifies that:
    1. Override values replace None base values
    2. Override None values don't replace base values
    """
    # Base with some None values
    base_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "api_key": "sk-base-key",
            # sandbox_mode, model, etc. will be None
        },
        "skills": []
    })

    # Override with different fields
    override_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "model": "gpt-4",
            # api_key not specified (will be None in override)
        },
        "skills": []
    })

    merged = base_config.merge_overrides(override_config)

    # api_key should be preserved from base
    assert merged.agent_config.api_key == "sk-base-key"
    # model should be added from override
    assert merged.agent_config.model == "gpt-4"


def test_codex_config_dict_merge():
    """
    Test that codex_config dicts are merged correctly.

    Verifies that:
    1. Keys from base config are preserved
    2. Keys from override update/add correctly
    3. Merge is additive, not replacement
    """
    base_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "codex_config": {
                "key1": "value1",
                "key2": "value2"
            }
        },
        "skills": []
    })

    override_config = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "codex_config": {
                "key2": "override2",
                "key3": "value3"
            }
        },
        "skills": []
    })

    merged = base_config.merge_overrides(override_config)

    # Should have all keys with correct values
    assert merged.agent_config.codex_config == {
        "key1": "value1",  # Preserved from base
        "key2": "override2",  # Updated from override
        "key3": "value3"  # Added from override
    }


def test_codex_config_none_handling():
    """
    Test codex_config merge when one or both are None.

    Verifies that:
    1. None base + dict override = dict
    2. dict base + None override = dict (preserved)
    3. None base + None override = None
    """
    # Case 1: None base + dict override
    base1 = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": []
    })
    override1 = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "codex_config": {"key": "value"}
        },
        "skills": []
    })
    merged1 = base1.merge_overrides(override1)
    assert merged1.agent_config.codex_config == {"key": "value"}

    # Case 2: dict base + None override
    base2 = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "codex_config": {"key": "value"}
        },
        "skills": []
    })
    override2 = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": []
    })
    merged2 = base2.merge_overrides(override2)
    assert merged2.agent_config.codex_config == {"key": "value"}

    # Case 3: None base + None override
    base3 = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": []
    })
    override3 = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": []
    })
    merged3 = base3.merge_overrides(override3)
    assert merged3.agent_config.codex_config is None


def test_skills_override_behavior():
    """
    Test that skills are replaced (not merged) when overriding.

    Verifies that:
    1. Non-empty override skills replace base skills completely
    2. Empty override skills keep base skills
    """
    base_config = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {"type": "anthropic-skill", "path": "./skill1"},
            {"type": "anthropic-skill", "path": "./skill2"},
        ]
    })

    # Override with different skills
    override_with_skills = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": [
            {"type": "anthropic-skill", "path": "./skill3"},
        ]
    })

    merged1 = base_config.merge_overrides(override_with_skills)
    assert len(merged1.skills) == 1
    assert merged1.skills[0].path == "./skill3"

    # Override with empty skills
    override_empty = AllAgentConfigs.from_dict({
        "agent_config": {"type": "codex-agent"},
        "skills": []
    })

    merged2 = base_config.merge_overrides(override_empty)
    # Empty list is falsy, so base skills should be preserved
    assert len(merged2.skills) == 2


def test_multiple_sequential_overrides():
    """
    Test that multiple sequential overrides work correctly.

    Verifies that:
    1. Each override preserves previous merge results
    2. Later overrides take precedence
    """
    base = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "api_key": "key1",
            "model": "model1",
        },
        "skills": []
    })

    override1 = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "model": "model2",
        },
        "skills": []
    })

    override2 = AllAgentConfigs.from_dict({
        "agent_config": {
            "type": "codex-agent",
            "api_key": "key3",
        },
        "skills": []
    })

    # Apply overrides sequentially
    merged1 = base.merge_overrides(override1)
    merged2 = merged1.merge_overrides(override2)

    # Final result should have:
    # - api_key from override2
    # - model from override1
    assert merged2.agent_config.api_key == "key3"
    assert merged2.agent_config.model == "model2"
