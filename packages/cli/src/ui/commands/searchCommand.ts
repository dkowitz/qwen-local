/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

const USAGE_MESSAGE =
  'Usage: /search <query>. Example: /search latest Node.js LTS release';

export const searchCommand: SlashCommand = {
  name: 'search',
  description: 'Run a web search using the configured provider',
  kind: CommandKind.BUILT_IN,
  action: (_context, args) => {
    const query = args.trim();
    if (!query) {
      return {
        type: 'message',
        messageType: 'error',
        content: USAGE_MESSAGE,
      } as const;
    }

    return {
      type: 'tool',
      toolName: 'web_search',
      toolArgs: { query },
    } as const;
  },
};
