/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';

import type { Config } from '../config/config.js';
import { getErrorMessage } from '../utils/errors.js';

interface TavilyResultItem {
  title: string;
  url: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilyResultItem[];
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */
  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: Array<{ title: string; url: string }>;
}

class WebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebSearchToolParams,
  ) {
    super(params);
  }

  override getDescription(): string {
    return `Searching the web for: "${this.params.query}"`;
  }

  async execute(signal: AbortSignal): Promise<WebSearchToolResult> {
    const requestedProvider = this.config.getWebSearchProvider
      ? this.config.getWebSearchProvider()
      : 'duckduckgo';

    const apiKey =
      this.config.getTavilyApiKey() || process.env['TAVILY_API_KEY'];

    const provider =
      requestedProvider === 'tavily' && apiKey ? 'tavily' : 'duckduckgo';
    const fellBackToDuckDuckGo = requestedProvider === 'tavily' && !apiKey;

    try {
      if (provider === 'tavily') {
        return await this.performTavilySearch(apiKey!, signal);
      }
      return await this.performDuckDuckGoSearch(signal, fellBackToDuckDuckGo);
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${this.params.query}": ${getErrorMessage(
        error,
      )}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
      };
    }
  }

  private async performTavilySearch(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: this.params.query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Tavily API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      );
    }

    const data = (await response.json()) as TavilySearchResponse;

    const sources = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
    }));

    const sourceListFormatted = sources.map(
      (s, i) => `[${i + 1}] ${s.title || 'Untitled'} (${s.url})`,
    );

    let content = data.answer?.trim() || '';
    if (!content) {
      content = sources
        .slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.title} - ${s.url}`)
        .join('\n');
    }

    if (sourceListFormatted.length > 0) {
      content += `\n\nSources:\n${sourceListFormatted.join('\n')}`;
    }

    if (!content.trim()) {
      return {
        llmContent: `No search results or information found for query: "${this.params.query}"`,
        returnDisplay: 'No information found.',
      };
    }

    const formattedContent = `Web search results for "${this.params.query}" (Tavily):\n\n${content}`;

    return {
      llmContent: formattedContent,
      returnDisplay: formattedContent,
      sources,
    };
  }

  private async performDuckDuckGoSearch(
    signal: AbortSignal,
    wasFallback: boolean,
  ): Promise<WebSearchToolResult> {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', this.params.query);
    url.searchParams.set('t', 'qwen-code');

    const response = await fetch(url, {
      method: 'GET',
      headers: getDuckDuckGoRequestHeaders(),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `DuckDuckGo API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      );
    }

    const html = await response.text();
    let parsedResults = parseDuckDuckGoResults(html, 5);

    if (parsedResults.length === 0) {
      try {
        const liteUrl = new URL('https://lite.duckduckgo.com/lite/');
        liteUrl.searchParams.set('q', this.params.query);

        const liteResponse = await fetch(liteUrl, {
          method: 'GET',
          headers: getDuckDuckGoRequestHeaders(),
          signal,
        });

        if (liteResponse.ok) {
          const liteHtml = await liteResponse.text();
          parsedResults = parseDuckDuckGoResults(liteHtml, 5);
        }
      } catch (liteError) {
        console.warn(
          'DuckDuckGo lite fallback failed:',
          getErrorMessage(liteError),
        );
      }
    }

    if (parsedResults.length === 0) {
      return {
        llmContent: `No search results or information found for query: "${this.params.query}" using DuckDuckGo.`,
        returnDisplay: 'No information found.',
      };
    }

    const sources = parsedResults.map((result) => ({
      title: result.title,
      url: result.url,
    }));

    const interpretedSummary = buildDuckDuckGoSummary(parsedResults);

    const formattedSources = sources.map(
      (result, index) => `[${index + 1}] ${result.title} (${result.url})`,
    );

    const fallbackNote = wasFallback
      ? 'Tavily API key not configured. Using DuckDuckGo instead.\n\n'
      : '';

    const content = `${fallbackNote}DuckDuckGo search summary for "${this.params.query}":\n\n${interpretedSummary}\n\nSources:\n${formattedSources.join('\n')}`;

    return {
      llmContent: content,
      returnDisplay: content,
      sources,
    };
  }
}

/**
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name: string = 'web_search';

  constructor(private readonly config: Config) {
    super(
      WebSearchTool.Name,
      'WebSearch',
      'Performs a web search using Tavily (when an API key is configured) or DuckDuckGo.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find information on the web.',
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  protected override validateToolParamValues(
    params: WebSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: WebSearchToolParams,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new WebSearchToolInvocation(this.config, params);
  }
}

function getDuckDuckGoRequestHeaders(): Record<string, string> {
  return {
    Accept: 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'User-Agent':
      'Mozilla/5.0 (compatible; QwenCode/1.0; +https://github.com/dkowitz/qwen-local)',
  };
}

function buildDuckDuckGoSummary(
  parsedResults: Array<{ title: string; url: string; snippet?: string }>,
): string {
  if (parsedResults.length === 0) {
    return 'No DuckDuckGo results were returned.';
  }

  const seenSentences = new Set<string>();
  const summarySentences: string[] = [];

  for (const result of parsedResults) {
    if (!result.snippet) {
      continue;
    }
    const cleanedSnippet = cleanDuckDuckGoText(result.snippet);
    if (!cleanedSnippet) {
      continue;
    }
    const sentences = splitIntoSentences(cleanedSnippet);
    for (const sentence of sentences) {
      if (sentence.length < 25) {
        continue;
      }
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      if (normalized.length === 0 || seenSentences.has(normalized)) {
        continue;
      }
      seenSentences.add(normalized);
      summarySentences.push(normalized);
      if (summarySentences.length >= 3) {
        break;
      }
    }
    if (summarySentences.length >= 3) {
      break;
    }
  }

  if (summarySentences.length === 0) {
    const topTitles = parsedResults
      .slice(0, 3)
      .map((result) => result.title)
      .filter((title) => title.trim().length > 0);

    if (topTitles.length === 0) {
      return 'Top sources did not include descriptive snippets.';
    }

    const joinedTitles = topTitles.join('; ');
    return `Top sources cover: ${joinedTitles}.`;
  }

  return summarySentences.join(' ');
}

function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet?: string }> {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const anchorRegex = /<a[^>]*class="[^"]*(?:result__a|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null && results.length < maxResults) {
    const rawHref = match[1];
    const normalizedUrl = normalizeDuckDuckGoHref(rawHref);
    if (!normalizedUrl) {
      continue;
    }

    if (results.some((existing) => existing.url === normalizedUrl)) {
      continue;
    }

    const title = cleanDuckDuckGoText(match[2]);
    if (!title) {
      continue;
    }

    const snippet = extractSnippetFromDuckDuckGoHtml(html, match.index + match[0].length);

    results.push({
      title,
      url: normalizedUrl,
      snippet,
    });
  }

  return results;
}

function extractSnippetFromDuckDuckGoHtml(
  html: string,
  startIndex: number,
): string | undefined {
  const searchWindow = html.slice(startIndex, startIndex + 800);
  const snippetRegex = /<div[^>]*class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const snippetMatch = snippetRegex.exec(searchWindow);
  if (!snippetMatch) {
    return undefined;
  }

  const cleaned = cleanDuckDuckGoText(snippetMatch[1]);
  return cleaned || undefined;
}

function splitIntoSentences(text: string): string[] {
  const cleaned = text
    .replace(/\[[^\]]*\]\([^\)]*\)/g, ' ') // strip markdown links
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[|=*]_+/g, ' ');

  const sentenceRegex = /(?<=[.!?])\s+/;
  return cleaned
    .split(sentenceRegex)
    .map((sentence) => sentence.replace(/^[*\-•]+\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function normalizeDuckDuckGoHref(href: string): string | null {
  if (!href) {
    return null;
  }

  try {
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    const resolved = new URL(href, 'https://duckduckgo.com');
    const uddg = resolved.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function cleanDuckDuckGoText(raw: string): string {
  const withoutTags = raw.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}
