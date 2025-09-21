/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchTool, type WebSearchToolParams } from './web-search.js';
import type { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';

// Mock GeminiClient and Config constructor
vi.mock('../core/client.js');
vi.mock('../config/config.js');

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe('WebSearchTool', () => {
  const abortSignal = new AbortController().signal;
  let mockGeminiClient: GeminiClient;
  let getTavilyApiKeyMock: ReturnType<typeof vi.fn>;
  let getWebSearchProviderMock: ReturnType<typeof vi.fn>;
  let mockConfigInstance: Config;
  let tool: WebSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();

    getTavilyApiKeyMock = vi.fn(() => 'test-api-key');
    getWebSearchProviderMock = vi.fn(() => 'tavily');

    mockConfigInstance = {
      getGeminiClient: () => mockGeminiClient,
      getProxy: () => undefined,
      getTavilyApiKey: getTavilyApiKeyMock,
      getWebSearchProvider: getWebSearchProviderMock,
      getRequestedWebSearchProvider: vi.fn(() => getWebSearchProviderMock()),
      setWebSearchProvider: vi.fn(),
    } as unknown as Config;

    mockGeminiClient = new GeminiClient(mockConfigInstance);
    tool = new WebSearchTool(mockConfigInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('build', () => {
    it('should return an invocation for a valid query', () => {
      const params: WebSearchToolParams = { query: 'test query' };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
      expect(invocation.params).toEqual(params);
    });

    it('should throw an error for an empty query', () => {
      const params: WebSearchToolParams = { query: '' };
      expect(() => tool.build(params)).toThrow(
        "The 'query' parameter cannot be empty.",
      );
    });

    it('should throw an error for a query with only whitespace', () => {
      const params: WebSearchToolParams = { query: '   ' };
      expect(() => tool.build(params)).toThrow(
        "The 'query' parameter cannot be empty.",
      );
    });
  });

  describe('execute', () => {
    it('should return Tavily search results', async () => {
      const params: WebSearchToolParams = { query: 'successful query' };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        answer: 'Here are your results.',
        results: [],
      }),
    } as Response);

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.any(Object),
      );
      const expectedContent =
        'Web search results for "successful query" (Tavily):\n\nHere are your results.';

      expect(result.llmContent).toBe(expectedContent);
      expect(result.returnDisplay).toBe(expectedContent);
      expect(result.sources).toEqual([]);
    });

    it('should handle Tavily responses without answers', async () => {
      const params: WebSearchToolParams = { query: 'no results query' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answer: '',
          results: [],
        }),
      } as Response);

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe(
        'No search results or information found for query: "no results query"',
      );
      expect(result.returnDisplay).toBe('No information found.');
    });

    it('should handle errors gracefully', async () => {
      const params: WebSearchToolParams = { query: 'error query' };

      mockFetch.mockRejectedValueOnce(new Error('API Failure'));

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Error:');
      expect(result.llmContent).toContain('API Failure');
      expect(result.returnDisplay).toBe('Error performing web search.');
    });

    it('should format Tavily results with sources', async () => {
      const params: WebSearchToolParams = { query: 'grounding query' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answer: 'This is a test response.',
          results: [
            { title: 'Example Site', url: 'https://example.com' },
            { title: 'Google', url: 'https://google.com' },
          ],
        }),
      } as Response);

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      const expectedLlmContent = `Web search results for "grounding query" (Tavily):\n\nThis is a test response.\n\nSources:\n[1] Example Site (https://example.com)\n[2] Google (https://google.com)`;

      expect(result.llmContent).toBe(expectedLlmContent);
      expect(result.returnDisplay).toBe(expectedLlmContent);
      expect(result.sources).toHaveLength(2);
    });

    it('should fallback to DuckDuckGo when Tavily API key is missing', async () => {
      getWebSearchProviderMock.mockReturnValue('tavily');
      getTavilyApiKeyMock.mockReturnValue(undefined);

      const params: WebSearchToolParams = { query: 'fallback query' };

      const duckDuckGoHtml = `
        <html>
          <body>
            <div class="results">
              <article class="result">
                <h2 class="result__title">
                  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Ffallback">Fallback Heading</a>
                </h2>
                <div class="result__snippet">Fallback summary from DuckDuckGo.</div>
              </article>
              <article class="result">
                <h2 class="result__title">
                  <a class="result__a" href="https://example.com/topic">Fallback Topic</a>
                </h2>
                <div class="result__snippet">Topic details here.</div>
              </article>
            </div>
          </body>
        </html>`;

      mockFetch.mockResolvedValueOnce(
        new Response(duckDuckGoHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      mockFetch.mockResolvedValueOnce(
        new Response(
          'Title: Dakar forecast\nMarkdown Content:\nExpect partly cloudy skies with occasional showers across Dakar this week. Humidity remains high while temperatures stay near 28°C during the afternoons.\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        ),
      );

      mockFetch.mockResolvedValueOnce(
        new Response(
          'Title: Dakar conditions\nMarkdown Content:\nWeather updates highlight consistent trade winds and the chance of scattered storms in the evenings. Travelers should prepare for humid conditions and intermittent rainfall.\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        ),
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://html.duckduckgo.com/html/'),
        expect.any(Object),
      );
      expect(result.llmContent).toContain(
        'Tavily API key not configured. Using DuckDuckGo instead.',
      );
      expect(result.llmContent).toContain(
        'Expect partly cloudy skies with occasional showers across Dakar this week.',
      );
      expect(result.llmContent).toContain(
        'Weather updates highlight consistent trade winds and the chance of scattered storms in the evenings.',
      );
      expect(result.returnDisplay).toBe(result.llmContent);
      expect(result.sources).toHaveLength(2);
    });

    it('should use DuckDuckGo when configured explicitly', async () => {
      getWebSearchProviderMock.mockReturnValue('duckduckgo');
      getTavilyApiKeyMock.mockReturnValue(undefined);

      const params: WebSearchToolParams = { query: 'duckduckgo query' };

      const duckDuckGoConfiguredHtml = `
        <html>
          <body>
            <div class="results">
              <article class="result">
                <h2 class="result__title">
                  <a class="result__a" href="https://example.com/a">Topic A</a>
                </h2>
                <div class="result__snippet">Details about topic A.</div>
              </article>
              <article class="result">
                <h2 class="result__title">
                  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Topic B</a>
                </h2>
              </article>
            </div>
          </body>
        </html>`;

      mockFetch.mockResolvedValueOnce(
        new Response(duckDuckGoConfiguredHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      mockFetch.mockResolvedValueOnce(
        new Response(
          'Title: Topic A\nMarkdown Content:\nTopic A details explain the primary considerations and provide an overview of the situation with practical guidance.\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        ),
      );

      mockFetch.mockResolvedValueOnce(
        new Response(
          'Title: Topic B\nMarkdown Content:\nTopic B paragraph describing the result in greater depth, including key metrics and recommendations for next steps.\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        ),
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://html.duckduckgo.com/html/'),
        expect.any(Object),
      );
      expect(result.llmContent).toContain(
        'DuckDuckGo search summary for "duckduckgo query"',
      );
      expect(result.llmContent).toContain(
        'Topic A details explain the primary considerations and provide an overview of the situation with practical guidance.',
      );
      expect(result.llmContent).toContain(
        'Topic B paragraph describing the result in greater depth, including key metrics and recommendations for next steps.',
      );
      expect(result.returnDisplay).toBe(result.llmContent);
      expect(result.sources).toHaveLength(2);
    });
  });
});
