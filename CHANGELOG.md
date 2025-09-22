# Changelog

## Unreleased

- Dynamically fetch and display the currently loaded model from a local server.
- Add a `/model` command to switch between available models.
- Unload the previous model before loading a new one.
- Remove Qwen OAuth integration, defaulting authentication to LM Studio or other OpenAI-compatible endpoints.
- Update README and onboarding copy to highlight the local-only workflow.
- Add DuckDuckGo-backed web search with optional Tavily support, plus `/search` and `/search-engine` commands for quick querying and provider selection.
- Add an `/export` command to save the current conversation (including tool output) to Markdown for easy sharing.
- Discover per-model context limits/tokenizer hints from LM Studio/OpenAI-compatible endpoints and surface them in the CLI UI and token budgeting.
- Handle streaming retries explicitly, showing the retry status, and automatically attempt a self-recovery after repeated stalls.
- Auto-recover when loop detection fires by cancelling pending tools, summarizing recent context, and dispatching a guided recovery prompt so the agent can continue autonomously.
- Harden provider failure handling by classifying network dropouts, cancelling tool execution, resetting the chat, and sending a stabilizer prompt after retries are exhausted.
- Automatically recover when the session hits turn or token ceilings—or when Gemini stops early for policy/token reasons—by cancelling the active turn and queueing tailored recovery prompts that keep the plan moving without user intervention.
- Add a configurable automatic turn budget plus tool auto-blacklisting heuristics so local agents can think longer while still breaking out of non-productive loops on their own.
