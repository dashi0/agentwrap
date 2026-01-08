# Codex Installation Guide

AgentWrap's `CodexAgent` requires the [OpenAI Codex CLI](https://openai.com/codex/) to be installed on your system. Unlike the TypeScript package which bundles Codex as a dependency, Python cannot auto-install Node.js CLI tools.

## Quick Installation

### Global Installation (Recommended for Development)

```bash
npm install -g @openai/codex
```

Verify installation:
```bash
codex --version
```

### Local Installation (For Project-Specific Use)

```bash
npm install @openai/codex
```

Add to PATH or use full path:
```bash
export PATH="$PATH:./node_modules/.bin"
# or
/path/to/node_modules/.bin/codex --version
```

## Installation by Platform

### macOS

1. Install Node.js (if not already installed):
```bash
brew install node
```

2. Install Codex CLI:
```bash
npm install -g @openai/codex
```

### Linux (Ubuntu/Debian)

1. Install Node.js and npm:
```bash
sudo apt update
sudo apt install nodejs npm
```

2. Install Codex CLI:
```bash
npm install -g @openai/codex
```

### Windows

1. Install Node.js from https://nodejs.org/

2. Install Codex CLI (in PowerShell or CMD):
```bash
npm install -g @openai/codex
```

## Docker Installation

If you're deploying AgentWrap in a containerized environment, you can use Docker to ensure all dependencies are installed.

### Sample Dockerfile

**Important**: This is a baseline Dockerfile that includes Codex CLI installation. You'll need to extend it with your own code, configuration files, and application-specific dependencies.

```dockerfile
# Base image with Python
FROM python:3.11-slim

# Install Node.js and npm (required for Codex CLI)
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Codex CLI globally
RUN npm install -g @openai/codex

# Install AgentWrap
RUN pip install --no-cache-dir agentwrap

# Set working directory
WORKDIR /app

# ==================================================
# TODO: Add your application-specific setup below
# ==================================================
# COPY your_app/ /app/
# COPY requirements.txt /app/
# RUN pip install -r requirements.txt
# COPY config/ /app/config/
# COPY skills/ /app/skills/

# Set environment variables (example)
# ENV OPENAI_API_KEY=your_key_here

# Expose port if running OpenAI-compatible server
EXPOSE 8000

# Default command (customize for your application)
CMD ["python", "-c", "from agentwrap import CodexAgent; print('AgentWrap ready!')"]
```

## Verification

Test that AgentWrap can find Codex:

```python
from agentwrap import CodexAgent

try:
    agent = CodexAgent()
    agent.check_prerequisites()
    print("✅ Codex CLI is available!")
except RuntimeError as e:
    print(f"❌ Error: {e}")
```

## Support

For more help:
- GitHub Issues: https://github.com/dashi0/agentwrap/issues
- OpenAI Codex Documentation: https://github.com/openai/codex-cli
