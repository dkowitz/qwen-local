/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchOpenAIModels, modelsToMetadata } from './availableModels.js';

function mockFetchSequence(responders: Array<(url?: URL | string) => Promise<Response>>): void {
  let callIndex = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
    const responder = responders[Math.min(callIndex, responders.length - 1)];
    callIndex += 1;
    return responder(url);
  }));
}

describe('availableModels', () => {
  const baseUrl = 'http://localhost:1234/v1';

  beforeEach(() => {
    process.env['OPENAI_BASE_URL'] = baseUrl;
  });

  afterEach(() => {
    delete process.env['OPENAI_BASE_URL'];
    vi.restoreAllMocks();
  });

  it('extracts metadata from the primary list response when available', async () => {
    mockFetchSequence([
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'local-coder',
                context_length: 131072,
                tokenizer: 'qwen-tokenizer',
              },
            ],
          }),
          { status: 200 },
        ),
    ]);

    const models = await fetchOpenAIModels();

    expect(models).toEqual([
      {
        id: 'local-coder',
        label: 'local-coder',
        isVision: false,
        contextWindow: 131072,
        promptWindow: undefined,
        tokenizer: 'qwen-tokenizer',
      },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to detail requests when list response lacks metadata', async () => {
    mockFetchSequence([
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: 'detail-model' }] }),
          { status: 200 },
        ),
      async (url) => {
        expect(String(url)).toContain('/v1/models/detail-model');
        return new Response(
          JSON.stringify({
            id: 'detail-model',
            max_input_tokens: 60000,
          }),
          { status: 200 },
        );
      },
    ]);

    const models = await fetchOpenAIModels();

    expect(models).toEqual([
      {
        id: 'detail-model',
        label: 'detail-model',
        isVision: false,
        contextWindow: undefined,
        promptWindow: 60000,
        tokenizer: undefined,
      },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('converts discovered models to metadata map', () => {
    const map = modelsToMetadata([
      { id: 'a', label: 'a', contextWindow: 4096 },
      { id: 'b', label: 'b' },
    ]);

    expect(map).toEqual({ a: { contextWindow: 4096, promptWindow: undefined, tokenizer: undefined } });
  });
});
