/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

export const searchEngineCommand: SlashCommand = {
  name: 'search-engine',
  altNames: ['searchengine'],
  description: 'Configure the default web search provider',
  kind: CommandKind.BUILT_IN,
  action: () => ({
    type: 'dialog',
    dialog: 'search_engine',
  }),
};
