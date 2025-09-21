/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelMetadata } from '@qwen-code/qwen-code-core';

export type AvailableModel = {
  id: string;
  label: string;
  isVision?: boolean;
  contextWindow?: number;
  promptWindow?: number;
  tokenizer?: string;
};

type RawModel = {
  id: string;
  [key: string]: unknown;
};

function coerceInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractContextMetadata(model: RawModel): Pick<AvailableModel, 'contextWindow' | 'promptWindow' | 'tokenizer'> {
  const directContext =
    coerceInteger(model['context_window']) ??
    coerceInteger(model['context_length']) ??
    coerceInteger(model['max_context_tokens']) ??
    coerceInteger(model['max_total_tokens']);
  const promptWindow =
    coerceInteger(model['max_input_tokens']) ??
    coerceInteger(model['prompt_window']) ??
    coerceInteger(model['max_prompt_tokens']);
  const tokenizer =
    typeof model['tokenizer'] === 'string'
      ? (model['tokenizer'] as string)
      : typeof model['encoding'] === 'string'
        ? (model['encoding'] as string)
        : undefined;

  return {
    contextWindow: directContext ?? undefined,
    promptWindow: promptWindow ?? undefined,
    tokenizer,
  };
}

async function fetchModelDetails(
  baseUrl: string,
  id: string,
): Promise<Partial<AvailableModel>> {
  try {
    const detailUrl = new URL(`/v1/models/${encodeURIComponent(id)}`, baseUrl);
    const response = await fetch(detailUrl);
    if (!response.ok) return {};
    const detail = (await response.json()) as RawModel;
    return extractContextMetadata(detail);
  } catch {
    return {};
  }
}

async function enrichModelMetadata(
  baseUrl: string,
  rawModel: RawModel,
): Promise<AvailableModel> {
  const base: AvailableModel = {
    id: rawModel.id,
    label: rawModel.id,
    isVision: isVisionModel(rawModel.id),
    ...extractContextMetadata(rawModel),
  };

  if (base.contextWindow || base.promptWindow || base.tokenizer) {
    return base;
  }

  const details = await fetchModelDetails(baseUrl, rawModel.id);
  return {
    ...base,
    ...details,
  };
}

function toMetadata(model: AvailableModel): ModelMetadata | undefined {
  const { contextWindow, promptWindow, tokenizer } = model;
  if (contextWindow || promptWindow || tokenizer) {
    return { contextWindow, promptWindow, tokenizer };
  }
  return undefined;
}

/**
 * Currently we use the single model of `OPENAI_MODEL` in the env.
 * In the future, after settings.json is updated, we will allow users to configure this themselves.
 */
export async function fetchOpenAIModels(): Promise<AvailableModel[]> {
  const baseUrl = process.env['OPENAI_BASE_URL'];
  if (!baseUrl) {
    return [];
  }

  try {
    const response = await fetch(new URL('/v1/models', baseUrl));
    if (!response.ok) {
      return [];
    }

    const json = await response.json();
    if (!json?.data || json.data.length === 0) {
      return [];
    }

    const models: AvailableModel[] = [];
    for (const rawModel of json.data as RawModel[]) {
      if (!rawModel?.id) continue;
      models.push(await enrichModelMetadata(baseUrl, rawModel));
    }

    return models;
  } catch {
    // Ignore errors to keep CLI resilient when the local server restarts
    return [];
  }
}

export function modelsToMetadata(models: AvailableModel[]): Record<string, ModelMetadata> {
  const entries: [string, ModelMetadata][] = [];
  for (const model of models) {
    const metadata = toMetadata(model);
    if (metadata) {
      entries.push([model.id, metadata]);
    }
  }
  return Object.fromEntries(entries);
}

export function getOpenAIAvailableModelFromEnv(): AvailableModel | null {
  const id = process.env['OPENAI_MODEL']?.trim();
  return id ? { id, label: id, isVision: isVisionModel(id) } : null;
}

/**
 * Hard code the default vision model as a string literal,
 * until our coding model supports multimodal.
 */
export function getDefaultVisionModel(): string {
  return 'lmstudio-vision';
}

export function isVisionModel(modelId: string): boolean {
  return /vision|vl/i.test(modelId);
}
