# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-01-08

### Added
- **Python**: Added `BaseAgent.check_prerequisites()` method for prerequisite checking
- **Python**: Added `CodexAgent.check_prerequisites()` to verify Codex CLI availability with friendly error messages
- **Docs**: Added comprehensive [Codex Installation Guide](./codex-installation-guide.md) with:
  - Platform-specific installation instructions (macOS, Linux, Windows)
  - Sample Dockerfile for containerized deployments
  - Troubleshooting section for common issues
- **Docs**: Added prerequisites section to main README explaining TypeScript vs Python differences

### Fixed
- **TypeScript**: Fixed codex path resolution in `CodexAgent` to correctly locate bundled `@openai/codex` package
  - Changed from relative path calculation to `require.resolve()` for proper resolution when installed
  - Ensures TypeScript users need zero setup beyond `npm install agentwrap`

### Changed
- **Docs**: Moved Codex installation guide to repo root (`docs/`) for multi-language accessibility
- **Docs**: Updated all documentation links to reference new docs location
- **Docs**: Added OpenAI Codex CLI link (https://openai.com/codex/) throughout documentation

## [0.1.0] - 2026-01-07

### Added
- Initial release of AgentWrap
- **TypeScript**: CodexAgent implementation with streaming support
- **Python**: CodexAgent implementation with streaming support
- **OpenAI-compatible API server** for both TypeScript and Python
- **Skills support**: Anthropic Skills and MCP (Model Context Protocol) integration
- **Function calling**: OpenAI function calling API compatibility
- **Streaming responses**: Real-time event streaming from agents
- **Type safety**: Full TypeScript types and Python type hints
- Published to npm and PyPI

### Features
- 📚 Python/TypeScript libraries - Call agents as simple functions
- 🌐 OpenAI-compatible API server - Drop-in replacement for OpenAI API
- 🧠 Advanced reasoning - Leverage modern agent capabilities (Codex)
- 📝 Markdown-based skills - Simple, declarative skill system
- 🔒 Built-in safety - Sandboxing and permission controls
