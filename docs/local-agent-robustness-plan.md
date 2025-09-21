# Local Agent Robustness Plan

## 1. Model Metadata & Token Budgeting
- Extend LM Studio model discovery to capture per-model context length, prompt limits, and tokenizer hints.
- Pipe metadata into `tokenLimit`, compression thresholds, and session limit UI so context management auto-adjusts after model switches.

## 2. Stream Retry Handling
- Honor `GeminiEventType.Retry` in the CLI: clear partial output, surface retry status, and track attempt counters.
- After configurable consecutive retries, initiate a self-recovery path instead of yielding control to the user.

## 3. Loop Auto-Recovery
- When loop detection fires, automatically summarize the stalled plan, reset tool scheduler state, and send a synthesize "continue" prompt (potentially via the Task tool) so the agent self-recovers.

## 4. Provider Failure Backoff
- Wrap the OpenAI-compatible pipeline with richer retry logic that classifies timeouts/connection drops and coordinates with tool execution.
- After repeated provider failures, fall back to a fresh chat state or a stabilizer prompt before re-entering the main loop.

## 5. Adaptive Turn Management
- Replace the fixed `MAX_TURNS` with configurable soft limits plus safeguards (longer thinking windows, automatic tool blacklisting after repeated errors) to support lengthy local runs without suppressing genuine progress.

