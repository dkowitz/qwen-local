# Authentication Setup

Qwen Code ships with a local-first authentication flow and supports any OpenAI-compatible endpoint. Choose the option that best fits your workflow:

1.  **LM Studio (Local Default):**
    - Run the LM Studio OpenAI-compatible server (`http://127.0.0.1:1234/v1`).
    - Start `qwen` and select the **OpenAI-compatible (LM Studio default)** option.
    - Supply the base URL (and API key if you configured one). Blank keys are accepted for local servers.
    - Recommended environment variables:

      ```bash
      export OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
      export OPENAI_API_KEY="lmstudio"  # placeholder if auth disabled
      export OPENAI_MODEL="LMStudio/lmstudio-default"
      ```

2.  **<a id="openai-api"></a>OpenAI-Compatible API (Remote or Custom):**
    - Use API keys for OpenAI, OpenRouter, Ollama, Azure OpenAI, or any compatible gateway.
    - Configure via environment variables or project `.env` files:

      ```bash
      export OPENAI_API_KEY="your_api_key"
      export OPENAI_BASE_URL="https://your-provider.example.com/v1"
      export OPENAI_MODEL="provider/model-name"
      ```

    - Typical providers: LM Studio, OpenAI, OpenRouter, Ollama (HTTP bridge), Azure OpenAI, or self-hosted FastAPI proxies.

## Switching Authentication Methods

To switch between authentication methods during a session, use the `/auth` command in the CLI interface:

```bash
# Within the CLI, type:
/auth
```

This will allow you to reconfigure your authentication method without restarting the application.

### Persisting Environment Variables with `.env` Files

You can create a **`.qwen/.env`** file in your project directory or in your home directory. Creating a plain **`.env`** file also works, but `.qwen/.env` is recommended to keep Qwen Code variables isolated from other tools.

**Important:** Some environment variables (like `DEBUG` and `DEBUG_MODE`) are automatically excluded from project `.env` files to prevent interference with qwen-code behavior. Use `.qwen/.env` files for qwen-code specific variables.

Qwen Code automatically loads environment variables from the **first** `.env` file it finds, using the following search order:

1. Starting in the **current directory** and moving upward toward `/`, for each directory it checks:
   1. `.qwen/.env`
   2. `.env`
2. If no file is found, it falls back to your **home directory**:
   - `~/.qwen/.env`
   - `~/.env`

> **Important:** The search stops at the **first** file encountered—variables are **not merged** across multiple files.

#### Examples

**Project-specific overrides** (take precedence when you are inside the project):

```bash
mkdir -p .qwen
cat >> .qwen/.env <<'EOF'
OPENAI_API_KEY="lmstudio"
OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
OPENAI_MODEL="LMStudio/lmstudio-default"
EOF
```

**User-wide settings** (available in every directory):

```bash
mkdir -p ~/.qwen
cat >> ~/.qwen/.env <<'EOF'
OPENAI_API_KEY="lmstudio"
OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
OPENAI_MODEL="LMStudio/lmstudio-default"
EOF
```

## Non-Interactive Mode / Headless Environments

When running Qwen Code in a non-interactive environment, you cannot use the OAuth login flow.
Instead, you must configure authentication using environment variables.

The CLI will automatically detect if it is running in a non-interactive terminal and will use the
OpenAI-compatible API method if configured:

1.  **OpenAI-Compatible API:**
    - Set the `OPENAI_API_KEY` environment variable.
    - Optionally set `OPENAI_BASE_URL` and `OPENAI_MODEL` for custom endpoints.
    - The CLI will use these credentials to authenticate with the API provider.

**Example for headless environments:**

```bash
export OPENAI_API_KEY="lmstudio"
export OPENAI_BASE_URL="http://127.0.0.1:1234/v1"
export OPENAI_MODEL="LMStudio/lmstudio-default"

# Run Qwen Code
qwen
```

If no API key is set in a non-interactive session, the CLI will exit with an error prompting you to configure authentication.
