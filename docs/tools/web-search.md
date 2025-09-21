# Web Search Tool (`web_search`)

This document describes the `web_search` tool.

## Description

Use `web_search` to perform a web search using either DuckDuckGo (default) or Tavily when an API key is available. The tool returns a concise answer with sources when possible.

### Arguments

`web_search` takes one argument:

- `query` (string, required): The search query.

## How to use `web_search`

By default the CLI uses DuckDuckGo, which requires no credentials. Configure a Tavily key to enable richer answers:

1. **Settings file**

   ```json
   {
     "tavilyApiKey": "tvly-your-api-key",
     "tools": {
       "webSearch": {
         "provider": "tavily"
       }
     }
   }
   ```

2. **Environment variable**: Set `TAVILY_API_KEY` in your shell or `.env` file.
3. **Command line**: Launch with `--tavily-api-key tvly-your-api-key` or `--web-search-provider tavily`.

You can switch providers interactively at any time with `/search-engine`. When no Tavily key is configured, the CLI automatically falls back to DuckDuckGo.

> The CLI prompts you to choose a provider the first time you start after upgrading.

Usage:

```
web_search(query="Your query goes here.")
```

Or from the interactive CLI session:

```
/search your query goes here
```

## `web_search` examples

Get information on a topic:

```
web_search(query="latest advancements in AI-powered code generation")
```

## Important notes

- **Response returned:** The `web_search` tool returns a concise answer when available, with a list of source links.
- **Citations:** Source links are appended as a numbered list.
- **API key:** Configure `TAVILY_API_KEY` via settings, environment variables, or command line arguments to enable Tavily. Without a key, the CLI automatically falls back to DuckDuckGo.
