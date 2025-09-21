# Changelog

## Unreleased

- Dynamically fetch and display the currently loaded model from a local server.
- Add a `/model` command to switch between available models.
- Unload the previous model before loading a new one.
- Remove Qwen OAuth integration, defaulting authentication to LM Studio or other OpenAI-compatible endpoints.
- Update README and onboarding copy to highlight the local-only workflow.
- Add DuckDuckGo-backed web search with optional Tavily support, plus `/search` and `/search-engine` commands for quick querying and provider selection.
