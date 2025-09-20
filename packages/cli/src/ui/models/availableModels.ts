/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

export type AvailableModel = {
  id: string;
  label: string;
  isVision?: boolean;
};



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
    if (json.data && json.data.length > 0) {
      return json.data.map((model: { id: string }) => ({
        id: model.id,
        label: model.id,
      }));
    }
  } catch (error) {
    // Ignore errors
  }

  return [];
}

export function getOpenAIAvailableModelFromEnv(): AvailableModel | null {
  const id = process.env['OPENAI_MODEL']?.trim();
  return id ? { id, label: id } : null;
}

/**
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
