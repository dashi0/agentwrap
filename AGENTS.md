# AgentWrap Agent Development Guide

This document outlines the core principles, conventions, and best practices for developing the AgentWrap framework. It serves as a guide for both human developers and AI agents contributing to this project.

---

## 🎯 Core Principles

### 1. **Simplicity First**

**Goal**: Wrap agent CLIs into callable libraries and compatible API servers — nothing more.

- **No complex business logic**: This project is a thin, clean wrapper around existing agent CLIs (e.g., codex-cli). Keep the codebase simple and focused.
- **Easy to understand**: All code, documentation, and examples should be straightforward enough for both humans and LLMs to comprehend quickly.
- **Minimal abstractions**: Prefer explicit, direct code over clever abstractions. If a feature adds complexity without clear value, don't add it.

**Examples of what to do:**
- ✅ Simple function wrappers around CLI commands
- ✅ Straightforward HTTP server adapters
- ✅ Clear, linear control flow

**Examples of what NOT to do:**
- ❌ Complex middleware chains
- ❌ Over-engineered plugin systems
- ❌ Unnecessary design patterns

---

### 2. **Security by Default**

**Goal**: All configurations should be secure by default. Always consider security implications in every change.

- **Sandbox mode**: Default to `read-only` sandbox mode, not `danger-full-access`
- **API keys**: Never log, print, or expose API keys in error messages
- **Input validation**: Always validate and sanitize external inputs
- **Path traversal**: Be cautious with file paths — validate before using
- **Dependency security**: Keep dependencies up to date and audit them regularly

**Security checklist for every change:**
- [ ] Does this expose sensitive information?
- [ ] Could this be exploited via malicious input?
- [ ] Is the default configuration secure?
- [ ] Are file paths properly validated?
- [ ] Are API keys properly protected?

---

### 3. **Comprehensive Test Coverage**

**Goal**: All features must have complete unit test (UT) and integration test coverage.

#### Unit Tests (UT)
- Test individual functions and classes in isolation
- Mock external dependencies (CLI, HTTP, file system)
- Fast execution (< 1s per test)
- Focus on edge cases and error handling

#### Integration Tests
- Test real agent execution end-to-end
- Verify actual CLI interactions
- Test HTTP server endpoints with real requests
- Ensure thread safety and concurrency handling

**Test requirements:**
- ✅ Every public function/method must have unit tests
- ✅ Every API endpoint must have integration tests
- ✅ Every CLI command wrapper must have integration tests
- ✅ All error paths must be tested
- ✅ Thread safety must be verified with concurrent tests

---

## 🐍 Python Code Standards

### General Guidelines
- **Follow PEP 8**: Use the official Python style guide
- **Target Python 3.8+**: Use `Union[]` instead of `|` for type annotations
- **Type annotations**: Use type hints for all functions, methods, and class attributes
- **Docstrings**: Document all public APIs with clear docstrings

### Thread Safety (Python Specific)

Python web servers (FastAPI/uvicorn) may use multiple threads or processes. Always consider thread safety:

```python
import threading

class MyServer:
    def __init__(self):
        # Protected shared state
        self._state_lock = threading.Lock()
        self._shared_data = {}

    def update_state(self, key: str, value: Any) -> None:
        """Thread-safe state update."""
        with self._state_lock:
            self._shared_data[key] = value
```

### Testing Conventions

#### Unit Tests
- Location: `tests/unit/`
- Naming: `test_<module_name>.py`
- Framework: pytest

#### Integration Tests
- Location: `tests/integration/`
- Naming: `test_<feature>_integration.py`
- Mark as slow: `@pytest.mark.integration`

---

## 🔷 TypeScript Code Standards

### General Guidelines
- **Modern TypeScript**: Use TypeScript 5.3+ features
- **Strict mode**: Enable all strict type checking options
- **ESLint + Prettier**: Follow project linter and formatter rules
- **Node 18+**: Target modern Node.js versions

### Project Configuration

#### TypeScript Compiler (tsconfig.json)
- **Strict mode enabled**: All strict flags on
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **No unused code**: Enable `noUnusedLocals` and `noUnusedParameters`

#### ESLint Rules
- **Extends**: `eslint:recommended`, `@typescript-eslint/recommended`
- **Unused vars**: Error (except args starting with `_`)
- **Explicit return types**: Off (rely on inference)
- **any type**: Warning (should be explicit)

#### Prettier Formatting
- **Semicolons**: Yes
- **Quotes**: Single quotes
- **Line width**: 100 characters
- **Trailing commas**: ES5 compatible
- **Tab width**: 2 spaces

### Testing Conventions

#### Unit Tests
- Location: `tests/unit/`
- Framework: Vitest
- Naming: `<module>.test.ts`

#### Integration Tests
- Location: `tests/integration/`
- Framework: Vitest
- Naming: `<feature>.integration.test.ts`

---

## 📁 Project Structure

```
agentwrap/
├── python/                    # Python implementation
│   ├── agentwrap/         # Main package
│   │   ├── agent.py          # Base agent interface
│   │   ├── agents/           # Agent implementations
│   │   ├── servers/          # HTTP server implementations
│   │   ├── server/           # Server utilities (MCP bridge, types)
│   │   └── config.py         # Configuration structures
│   └── tests/                # Test suite
│       ├── unit/             # Unit tests
│       └── integration/      # Integration tests
│
├── typescript/               # TypeScript implementation
│   ├── src/                  # Source code
│   │   ├── agent.ts          # Base agent interface
│   │   ├── agents/           # Agent implementations
│   │   ├── servers/          # HTTP server implementations
│   │   └── config.ts         # Configuration structures
│   └── tests/                # Test suite
│       ├── unit/             # Unit tests
│       └── integration/      # Integration tests
│
└── AGENTS.md                 # This file
```

---

## 🔄 Development Workflow

### Before Making Changes
1. **Read this guide** to understand principles and conventions
2. **Check existing code** for similar patterns
3. **Consider security** implications of your changes
4. **Plan tests** before writing implementation

### Making Changes
1. **Keep it simple** — is there a simpler way?
2. **Write tests first** (TDD) when possible
3. **Add type annotations** for all new code
4. **Document public APIs** with clear docstrings/JSDoc
5. **Handle errors explicitly** — no silent failures

### Before Committing
1. **Run all tests** and ensure they pass
2. **Run linters** and fix all issues
3. **Check test coverage** — aim for 100% on new code
4. **Review security checklist** above
5. **Update documentation** if needed

---

## 📝 Changelog

When making significant changes, update this guide to reflect new conventions or best practices. Keep this document as a living guide that evolves with the project.

---

*Last updated: 2026-01-07*
