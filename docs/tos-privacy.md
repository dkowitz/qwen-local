# Qwen Code: Terms of Service and Privacy Notice

Qwen Code is an open-source AI coding assistant that connects to the OpenAI-compatible endpoint you configure. There is no built-in hosted authentication service—your chosen backend (local or remote) defines the applicable terms of service and privacy guarantees.

## Choosing your backend

| Scenario                | Example Provider                 | Terms of Service                                   | Privacy / Data Handling                                 |
| :---------------------- | :------------------------------- | :------------------------------------------------- | :------------------------------------------------------ |
| Local default           | LM Studio (self-hosted)          | Governed by your local usage                       | Requests stay on your machine unless you enable logging |
| Remote OpenAI-compatible | OpenAI, OpenRouter, Azure, etc. | Refer to the provider's published terms of service | Refer to the provider's published privacy policy        |

When you point Qwen Code at a provider, you agree to that provider's policies. Review their documentation for details about quotas, data retention, and acceptable use.

## Authentication recap

- **LM Studio / self-hosted:** No data leaves your device unless you explicitly forward traffic. Credentials can be blank or local placeholders.
- **Remote APIs:** Supply the API key and endpoint provided by your vendor. Network traffic, logging, and retention are governed by that service.

Detailed setup instructions are available in the [Authentication Setup](./cli/authentication.md) guide.

## Usage Statistics and Telemetry

Qwen Code can optionally collect anonymous usage statistics to improve the CLI experience. This data collection is disabled by default and can be controlled through configuration settings.

### What data is collected (when enabled)

- Anonymous usage statistics (commands run, performance metrics)
- Error reports and crash data
- Feature usage patterns

### Opt-out instructions

Disable telemetry by following the steps in the [Usage Statistics Configuration](./cli/configuration.md#usage-statistics) documentation.

> **Note:** Telemetry settings only affect data collected by Qwen Code itself. Remote providers may collect their own metrics according to their policies.

## Frequently Asked Questions (FAQ)

### 1. Is my code used to train AI models?

Qwen Code does not use your prompts or code for model training. If you use a remote provider, model training policies depend on that provider. For local backends such as LM Studio, data never leaves your machine unless you enable upstream syncing.

### 2. What does the Usage Statistics setting control?

It toggles optional, anonymous telemetry collected by Qwen Code. It does **not** affect:

- The content of your prompts or responses
- Files read or written on disk
- Logs collected by your chosen provider

### 3. How do I switch providers?

- During startup, choose the OpenAI-compatible option and provide new connection details.
- Inside the CLI, run `/auth` to reopen the authentication dialog.
- Update environment variables or `.env` files to persist default values for future sessions.

For step-by-step examples, see the [Authentication Setup](./cli/authentication.md) documentation.
