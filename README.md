# Qwen Code

<div align="center">

![Qwen Code Screenshot](./docs/assets/qwen-screenshot.png)

[![npm version](https://img.shields.io/npm/v/@qwen-code/qwen-code.svg)](https://www.npmjs.com/package/@qwen-code/qwen-code)
[![License](https://img.shields.io/github/license/QwenLM/qwen-code.svg)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Downloads](https://img.shields.io/npm/dm/@qwen-code/qwen-code.svg)](https://www.npmjs.com/package/@qwen-code/qwen-code)

**AI-powered command-line workflow tool for developers**

[Installation](#installation) • [Quick Start](#quick-start) • [Features](#key-features) • [Documentation](./docs/) • [Contributing](./CONTRIBUTING.md)

</div>

<div align="center">
  
  <a href="https://qwenlm.github.io/qwen-code-docs/de/">Deutsch</a> | 
  <a href="https://qwenlm.github.io/qwen-code-docs/fr">français</a> | 
  <a href="https://qwenlm.github.io/qwen-code-docs/ja/">日本語</a> | 
  <a href="https://qwenlm.github.io/qwen-code-docs/ru">Русский</a> | 
  <a href="https://qwenlm.github.io/qwen-code-docs/zh/">中文</a>
  
</div>

Qwen Code is a powerful command-line AI workflow tool adapted from [**Gemini CLI**](https://github.com/google-gemini/gemini-cli) ([details](./README.gemini.md)), specifically optimized for [Qwen3-Coder](https://github.com/QwenLM/Qwen3-Coder) models. It enhances your development workflow with advanced code understanding, automated tasks, and intelligent assistance.

> This fork defaults to a fully local setup powered by LM Studio. Configure any OpenAI-compatible endpoint if you prefer a different backend.

## 💡 Local-First Setup

Qwen Code now defaults to running entirely against a local OpenAI-compatible server such as [LM Studio](https://lmstudio.ai/).

### 🔌 LM Studio (Default)

- Launch LM Studio and enable the OpenAI-compatible server (`http://127.0.0.1:1234/v1` by default).
- Start `qwen` and select the **OpenAI-compatible (LM Studio default)** auth option.
- Provide your LM Studio endpoint (and API key if you configured one) when prompted, or set `OPENAI_BASE_URL` / `OPENAI_API_KEY` in `.env`.

### 🌐 Other OpenAI-Compatible Providers

- Point `OPENAI_BASE_URL` and `OPENAI_API_KEY` to any OpenAI-compatible service (Ollama, OpenRouter, OpenAI, etc.).
- Switch providers at any time with `/auth` or by updating environment variables.

For detailed setup instructions, see [Authorization](#authorization).

> [!NOTE]
> Local deployments stay on your machine. Remote providers may incur network usage and follow their own quotas.

## Key Features

- **Code Understanding & Editing** - Query and edit large codebases beyond traditional context window limits
- **Workflow Automation** - Automate operational tasks like handling pull requests and complex rebases
- **Enhanced Parser** - Adapted parser specifically optimized for Qwen-Coder models

## Installation

### Prerequisites

Ensure you have [Node.js version 20](https://nodejs.org/en/download) or higher installed.

```bash
curl -qL https://www.npmjs.com/install.sh | sh
```

### Install from npm

```bash
npm install -g @qwen-code/qwen-code@latest
qwen --version
```

### Install from source

```bash
git clone https://github.com/QwenLM/qwen-code.git
cd qwen-code
npm install
npm install -g .
```

### Install globally with Homebrew (macOS/Linux)

```bash
brew install qwen-code
```

## Quick Start

```bash
# Start Qwen Code
qwen

# Example commands
> Explain this codebase structure
> Help me refactor this function
> Generate unit tests for this module
```

### Session Management

Control your token usage with configurable session limits to optimize costs and performance.

#### Configure Session Token Limit

Create or edit `.qwen/settings.json` in your home directory:

```json
{
  "sessionTokenLimit": 32000
}
```

#### Session Commands

- **`/compress`** - Compress conversation history to continue within token limits
- **`/clear`** - Clear all conversation history and start fresh
- **`/stats`** - Check current token usage and limits

> 📝 **Note**: Session token limit applies to a single conversation, not cumulative API calls.

### Authorization

Choose your preferred authentication method based on your needs:

#### 1. LM Studio (Local Default)

1. Install and launch [LM Studio](https://lmstudio.ai/).
2. Enable the OpenAI-compatible server (default URL: `http://127.0.0.1:1234/v1`).
3. Start `qwen`, choose the LM Studio option, and follow the prompts to supply the base URL and optional key.

Environment variable example:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
export OPENAI_API_KEY="lmstudio" # placeholder when auth is disabled
export OPENAI_MODEL="LMStudio/lmstudio-default"
```

Project `.env` example:

```env
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
OPENAI_API_KEY=lmstudio
OPENAI_MODEL=LMStudio/lmstudio-default
```

#### 2. Custom OpenAI-Compatible API

Point Qwen Code at any OpenAI-compatible endpoint:

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_BASE_URL="https://your-provider.example.com/v1"
export OPENAI_MODEL="provider/model-name"
```

- Works with OpenRouter, Ollama, OpenAI, and self-hosted gateways.
- Use `/auth` to re-run the selection dialog after changing environment variables.
- Check your provider's documentation for quotas, pricing, and usage policies.

## Usage Examples

### 🔍 Explore Codebases

```bash
cd your-project/
qwen

# Architecture analysis
> Describe the main pieces of this system's architecture
> What are the key dependencies and how do they interact?
> Find all API endpoints and their authentication methods
```

### 💻 Code Development

```bash
# Refactoring
> Refactor this function to improve readability and performance
> Convert this class to use dependency injection
> Split this large module into smaller, focused components

# Code generation
> Create a REST API endpoint for user management
> Generate unit tests for the authentication module
> Add error handling to all database operations
```

### 🔄 Automate Workflows

```bash
# Git automation
> Analyze git commits from the last 7 days, grouped by feature
> Create a changelog from recent commits
> Find all TODO comments and create GitHub issues

# File operations
> Convert all images in this directory to PNG format
> Rename all test files to follow the *.test.ts pattern
> Find and remove all console.log statements
```

### 🐛 Debugging & Analysis

```bash
# Performance analysis
> Identify performance bottlenecks in this React component
> Find all N+1 query problems in the codebase

# Security audit
> Check for potential SQL injection vulnerabilities
> Find all hardcoded credentials or API keys
```

## Popular Tasks

### 📚 Understand New Codebases

```text
> What are the core business logic components?
> What security mechanisms are in place?
> How does the data flow through the system?
> What are the main design patterns used?
> Generate a dependency graph for this module
```

### 🔨 Code Refactoring & Optimization

```text
> What parts of this module can be optimized?
> Help me refactor this class to follow SOLID principles
> Add proper error handling and logging
> Convert callbacks to async/await pattern
> Implement caching for expensive operations
```

### 📝 Documentation & Testing

```text
> Generate comprehensive JSDoc comments for all public APIs
> Write unit tests with edge cases for this component
> Create API documentation in OpenAPI format
> Add inline comments explaining complex algorithms
> Generate a README for this module
```

### 🚀 Development Acceleration

```text
> Set up a new Express server with authentication
> Create a React component with TypeScript and tests
> Implement a rate limiter middleware
> Add database migrations for new schema
> Configure CI/CD pipeline for this project
```

## Commands & Shortcuts

### Session Commands

- `/help` - Display available commands
- `/clear` - Clear conversation history
- `/compress` - Compress history to save tokens
- `/stats` - Show current session information
- `/exit` or `/quit` - Exit Qwen Code

### Keyboard Shortcuts

- `Ctrl+C` - Cancel current operation
- `Ctrl+D` - Exit (on empty line)
- `Up/Down` - Navigate command history

## Benchmark Results

### Terminal-Bench Performance

| Agent     | Model              | Accuracy |
| --------- | ------------------ | -------- |
| Qwen Code | Qwen3-Coder-480A35 | 37.5%    |
| Qwen Code | Qwen3-Coder-30BA3B | 31.3%    |

## Development & Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) to learn how to contribute to the project.

For detailed authentication setup, see the [authentication guide](./docs/cli/authentication.md).

## Troubleshooting

If you encounter issues, check the [troubleshooting guide](docs/troubleshooting.md).

## Acknowledgments

This project is based on [Google Gemini CLI](https://github.com/google-gemini/gemini-cli). We acknowledge and appreciate the excellent work of the Gemini CLI team. Our main contribution focuses on parser-level adaptations to better support Qwen-Coder models.

## License

[LICENSE](./LICENSE)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=QwenLM/qwen-code&type=Date)](https://www.star-history.com/#QwenLM/qwen-code&Date)
