# Repository Guidelines

## Project Structure & Module Organization
- `packages/cli/src` implements the end-user CLI, command router, and interactive flows; generated assets ship from `bundle/`.
- `packages/core/src` contains shared services (model clients, OAuth, storage) consumed across packages.
- `packages/vscode-ide-companion/src` and `packages/test-utils` house the IDE companion extension and reusable test helpers.
- `integration-tests/` exercises full CLI scenarios, while `docs/` and `scripts/` provide user docs and build tooling.

## Build, Test, and Development Commands
- `npm install` bootstraps the monorepo workspaces; rerun after adding dependencies in any package.
- `npm run build` transpiles all packages; use `npm run build:all` to also refresh sandbox artifacts.
- `npm run start` launches the CLI from source, and `npm run bundle` creates the distributable entry point.
- `npm run lint`, `npm run format`, and `npm run typecheck` keep code style, formatting, and types consistent.
- `npm run test`, `npm run test:integration:sandbox:none`, and `npm run preflight` cover unit suites, sandboxless end-to-end checks, and the full CI gate.

## Coding Style & Naming Conventions
- TypeScript is mandatory; prefer named exports (`import/no-default-export` warns otherwise) and avoid `any` unless suppressed with rationale.
- Follow Prettier defaults (2-space indentation, trailing commas) via `npm run format`; never hand-format large diffs.
- Use `camelCase` for functions and variables, `PascalCase` for classes and React components, and `SCREAMING_SNAKE_CASE` only for constants.
- Keep module boundaries clean—do not reach into other packages beyond their public exports, and favor small, pure functions.

## Testing Guidelines
- Vitest drives all suites; co-locate specs as `*.test.ts` / `*.spec.ts` beside production code.
- `packages/cli/vitest.config.ts` enforces V8 coverage output—maintain or improve package-level coverage when adding code.
- Record integration scenarios in `integration-tests/`; allow the sandbox to default to `GEMINI_SANDBOX=false` locally unless you need Docker/Podman coverage.

## Commit & Pull Request Guidelines
- Adopt Conventional Commits (`feat:`, `fix:`, `chore:`...) with concise scope descriptions; reference issues (`(#123)`) as shown in the history.
- Open an issue before substantial work, keep PRs focused, and mark drafts until ready for review.
- Run `npm run preflight` before submission, update affected docs (especially under `docs/`), and include CLI output or screenshots when behavior changes.

## Security & Configuration Tips
- Target Node.js 20.19.x for development parity; use `nvm` or similar to pin versions.
- Store OAuth credentials securely—never commit `.qwen/` caches; see `SECURITY.md` for disclosure steps.
- Enable sandboxing (`GEMINI_SANDBOX=docker|podman`) before running privileged commands in integration tests.
