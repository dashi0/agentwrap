---
name: echo
description: Simple echo skill for demonstration. Use this skill when you need to echo or repeat back user input. Returns the input with timestamp and metadata.
---

# Echo Skill

A simple demonstration skill that echoes back user input.

## Purpose

Demonstrates how to create and use Anthropic Skills with agentwrap:
- Skill invocation
- Input/output handling
- Script execution

## Workflow

1. Receive user input
2. Execute the echo script with the input
3. Return the echoed response with metadata

## Usage

To echo a message:

```bash
node scripts/echo.cjs "Your message here"
```

## Output Format

```json
{
  "status": "success",
  "echo": "Your message here",
  "timestamp": "2026-01-05T12:00:00",
  "test_marker": "ECHO_EXECUTED"
}
```

## Notes

This is a demonstration skill. Real skills would perform more complex
operations like fetching data, analyzing content, or interacting with APIs.
