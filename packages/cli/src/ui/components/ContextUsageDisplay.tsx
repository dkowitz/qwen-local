/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { Colors } from '../colors.js';
import { tokenLimit } from '@qwen-code/qwen-code-core';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  contextLimit,
}: {
  promptTokenCount: number;
  model: string;
  contextLimit?: number;
}) => {
  const limit = contextLimit && contextLimit > 0 ? contextLimit : tokenLimit(model);
  const ratio = limit > 0 ? Math.min(Math.max(promptTokenCount / limit, 0), 1) : 0;
  const percentRemaining = Math.max(0, 1 - ratio) * 100;

  return (
    <Text color={Colors.Gray}>
      ({percentRemaining.toFixed(0)}% context left)
    </Text>
  );
};
