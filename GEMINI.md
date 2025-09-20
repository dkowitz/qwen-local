# Gemini Code Generation Context

This document provides context for Gemini to understand the Qwen Code project for code generation and analysis.

## Project Overview

Qwen Code is a powerful command-line AI workflow tool adapted from Gemini CLI, specifically optimized for Qwen3-Coder models. It enhances development workflows with advanced code understanding, automated tasks, and intelligent assistance.

The project is a TypeScript monorepo managed with npm workspaces. The main packages are:

*   `packages/cli`: The command-line interface.
*   `packages/core`: The core backend logic.
*   `packages/test-utils`: Utilities for testing.
*   `packages/vscode-ide-companion`: A companion extension for VS Code.

## Building and Running

### Prerequisites

*   Node.js >= 20.0.0
*   npm

### Installation

```bash
npm install
```

### Building

To build all packages:

```bash
npm run build
```

### Running

To start the CLI from the source code:

```bash
npm run start
```

### Testing

To run unit tests:

```bash
npm run test
```

To run integration tests:

```bash
npm run test:e2e
```

To run all checks (linting, formatting, tests):

```bash
npm run preflight
```

## Development Conventions

### Code Style

*   The project uses Prettier for code formatting (`npm run format`).
*   ESLint is used for linting (`npm run lint`).
*   Coding style, patterns, and conventions should be consistent with the existing codebase.

### Commits and Pull Requests

*   Follow the [Conventional Commits](https://www.conventionalcommits.org/) standard for commit messages.
*   All PRs should be linked to an existing issue.
*   Keep PRs small and focused on a single issue.
*   Ensure all checks pass (`npm run preflight`) before submitting a PR.
*   Update documentation in the `/docs` directory for any user-facing changes.

### Project Structure

*   `packages/`: Contains the individual sub-packages of the project.
    *   `cli/`: The command-line interface.
    *   `core/`: The core backend logic for the Gemini CLI.
*   `docs/`: Contains all project documentation.
*   `scripts/`: Utility scripts for building, testing, and development tasks.
