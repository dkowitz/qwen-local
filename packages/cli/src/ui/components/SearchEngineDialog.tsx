/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';

export type SearchEngineOption = 'duckduckgo' | 'tavily';

interface SearchEngineDialogProps {
  onSelect: (provider: SearchEngineOption) => void;
  onCancel: () => void;
  initialProvider: SearchEngineOption;
  tavilyApiKeyConfigured: boolean;
}

export const SearchEngineDialog: React.FC<SearchEngineDialogProps> = ({
  onSelect,
  onCancel,
  initialProvider,
  tavilyApiKeyConfigured,
}) => {
  const items = useMemo(
    () => [
      {
        label: 'DuckDuckGo (no API key required)',
        value: 'duckduckgo' as SearchEngineOption,
      },
      {
        label: 'Tavily (requires API key)',
        value: 'tavily' as SearchEngineOption,
      },
    ],
    [],
  );

  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === initialProvider),
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onCancel();
      }
    },
    { isActive: true },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Select a web search provider</Text>
      <Box marginTop={1}>
        <Text>
          Choose which service Qwen Code should use when running the WebSearch
          tool or the <Text bold color={Colors.AccentPurple}>/search</Text>{' '}
          command.
        </Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={initialIndex}
          onSelect={onSelect}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentPurple}>
          Hint: you can always change this later with /search-engine
        </Text>
      </Box>
      {!tavilyApiKeyConfigured && (
        <Box marginTop={1}>
          <Text color={Colors.AccentYellow}>
            Tavily requires an API key. Add `"tavilyApiKey"` to your settings
            or set the TAVILY_API_KEY environment variable to enable it.
          </Text>
        </Box>
      )}
    </Box>
  );
};
