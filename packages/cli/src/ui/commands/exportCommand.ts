/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import {
  type SlashCommand,
  CommandKind,
  type MessageActionReturn,
} from './types.js';
import {
  type HistoryItem,
  type HistoryItemWithoutId,
} from '../types.js';
import type { ToolResultDisplay } from '@qwen-code/qwen-code-core';

type ExportableHistoryItem = HistoryItem | HistoryItemWithoutId;

type ExportMetadata = {
  model: string;
  sessionId: string;
  timestamp: Date;
};

const DEFAULT_EXPORT_DIR = path.join('.qwen', 'conversations');

function formatTimestampForFilename(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function sanitizeText(rawText: string | undefined): string {
  if (!rawText) {
    return '';
  }
  return stripAnsi(rawText).replace(/\r/g, '');
}

function wrapCodeBlock(content: string, language = ''): string {
  const clean = sanitizeText(content);
  return `\u0060\u0060\u0060${language}\n${clean}\n\u0060\u0060\u0060`;
}

function formatToolResultDisplay(result?: ToolResultDisplay | string): string {
  if (!result) {
    return '';
  }

  if (typeof result === 'string') {
    return sanitizeText(result);
  }

  if ('fileDiff' in result) {
    const diffHeader = result.fileName
      ? `Diff for ${result.fileName}`
      : 'Diff';
    const diffStat = result.diffStat
      ? `\n\n- AI added lines: ${result.diffStat.ai_added_lines}` +
        `\n- AI removed lines: ${result.diffStat.ai_removed_lines}` +
        `\n- User added lines: ${result.diffStat.user_added_lines}` +
        `\n- User removed lines: ${result.diffStat.user_removed_lines}`
      : '';
    return `${diffHeader}\n\n${wrapCodeBlock(result.fileDiff, 'diff')}${diffStat}`;
  }

  if ('type' in result && result.type === 'todo_list') {
    const todos = result.todos
      .map((todo) => `- [${todo.status === 'completed' ? 'x' : ' '}] ${sanitizeText(todo.content)}`)
      .join('\n');
    return `Todo Items:\n${todos}`;
  }

  if ('type' in result && result.type === 'task_execution') {
    const lines = [
      `Task: ${sanitizeText(result.taskDescription)}`,
      `Status: ${result.status}`,
    ];
    if (result.result) {
      lines.push('', sanitizeText(result.result));
    }
    if (result.executionSummary) {
      lines.push('', wrapCodeBlock(JSON.stringify(result.executionSummary, null, 2), 'json'));
    }
    if (result.toolCalls?.length) {
      for (const call of result.toolCalls) {
        lines.push(
          '',
          `  • Tool ${call.name} (${call.status})`,
          call.result ? `    ${sanitizeText(call.result)}` : '',
        );
      }
    }
    return lines.filter(Boolean).join('\n');
  }

  return wrapCodeBlock(JSON.stringify(result, null, 2), 'json');
}

function formatHistoryItem(item: ExportableHistoryItem): string | null {
  switch (item.type) {
    case 'user':
      return `### User\n\n${sanitizeText(item.text)}`;
    case 'user_shell':
      return `### User (shell)\n\n${wrapCodeBlock(item.text ?? '', 'bash')}`;
    case 'gemini':
    case 'gemini_content':
      return `### Assistant\n\n${sanitizeText(item.text)}`;
    case 'info':
      return `> **Info:** ${sanitizeText(item.text)}`;
    case 'error':
      return `> **Error:** ${sanitizeText(item.text)}`;
    case 'about':
      return (
        '### About\n\n' +
        [
          `- CLI version: ${sanitizeText(item.cliVersion)}`,
          `- OS: ${sanitizeText(item.osVersion)}`,
          `- Sandbox: ${sanitizeText(item.sandboxEnv)}`,
          `- Model: ${sanitizeText(item.modelVersion)}`,
          `- Auth: ${sanitizeText(item.selectedAuthType)}`,
          `- GCP Project: ${sanitizeText(item.gcpProject)}`,
          `- IDE Client: ${sanitizeText(item.ideClient)}`,
        ].join('\n')
      );
    case 'help':
      return '### Help\n\nSee `/help` inside the CLI for the interactive command list.';
    case 'stats':
      return `### Session Stats\n\n- Duration: ${sanitizeText(item.duration)}`;
    case 'model_stats':
      return '### Model Stats\n\nModel usage statistics are available in the CLI.';
    case 'tool_stats':
      return '### Tool Stats\n\nTool usage statistics are available in the CLI.';
    case 'quit':
      return `### Session Ended\n\n- Duration: ${sanitizeText(item.duration)}`;
    case 'quit_confirmation':
      return `### Quit Confirmation\n\n- Duration: ${sanitizeText(item.duration)}`;
    case 'compression': {
      const { compression } = item;
      const lines = [
        '### Conversation Compression',
        '',
        `- Status: ${compression.compressionStatus ?? (compression.isPending ? 'pending' : 'unknown')}`,
        `- Original tokens: ${
          compression.originalTokenCount != null
            ? compression.originalTokenCount
            : 'unknown'
        }`,
        `- Compressed tokens: ${
          compression.newTokenCount != null ? compression.newTokenCount : 'unknown'
        }`,
      ];
      return lines.join('\n');
    }
    case 'summary': {
      const { summary } = item;
      const lines = ['### Conversation Summary', '', `- Status: ${summary.stage}`];
      if (summary.filePath) {
        lines.push(`- File: ${summary.filePath}`);
      }
      if (!summary.isPending && summary.stage === 'completed') {
        lines.push('', 'Summary generated successfully.');
      }
      return lines.join('\n');
    }
    case 'tool_group': {
      const sections: string[] = [];
      for (const tool of item.tools) {
        const header = `### Tool Call: ${sanitizeText(tool.name)} (${tool.status})`;
        const description = tool.description
          ? `\n\n${sanitizeText(tool.description)}`
          : '';
        const confirmation = tool.confirmationDetails
          ? `\n\n> Confirmation requested: ${tool.confirmationDetails.type}`
          : '';
        let result = '';
        if (tool.resultDisplay) {
          if (typeof tool.resultDisplay === 'string') {
            result = tool.renderOutputAsMarkdown
              ? `\n\n${tool.resultDisplay}`
              : `\n\n${wrapCodeBlock(tool.resultDisplay)}`;
          } else {
            result = `\n\n${formatToolResultDisplay(tool.resultDisplay)}`;
          }
        }
        sections.push(`${header}${description}${confirmation}${result}`);
      }
      return sections.join('\n\n');
    }
    default:
      return null;
  }
}

function buildMarkdown(
  items: ExportableHistoryItem[],
  metadata: ExportMetadata,
  pendingItem: HistoryItemWithoutId | null,
): string {
  const metaLines = [
    '# Conversation Export',
    '',
    `- Model: ${metadata.model}`,
    `- Session: ${metadata.sessionId}`,
    `- Exported: ${metadata.timestamp.toISOString()}`,
    `- Entries: ${items.length + (pendingItem ? 1 : 0)}`,
    '',
    '---',
    '',
  ];

  const body: string[] = [];
  for (const item of items) {
    const section = formatHistoryItem(item);
    if (section) {
      body.push(section);
    }
  }

  if (pendingItem) {
    const pendingSection = formatHistoryItem(pendingItem);
    if (pendingSection) {
      body.push(`${pendingSection}\n\n> _Pending item when exported._`);
    }
  }

  if (body.length === 0) {
    body.push('No conversation entries to export.');
  }

  return [...metaLines, ...body].join('\n');
}

async function resolveExportPath(
  projectRoot: string,
  timestamp: Date,
  rawArg: string,
): Promise<{ absolutePath: string; displayPath: string }> {
  const trimmedArg = rawArg.trim();
  let candidatePath: string;

  if (trimmedArg) {
    candidatePath = path.isAbsolute(trimmedArg)
      ? trimmedArg
      : path.join(projectRoot, trimmedArg);
  } else {
    const filename = `conversation-${formatTimestampForFilename(timestamp)}.md`;
    candidatePath = path.join(projectRoot, DEFAULT_EXPORT_DIR, filename);
  }

  if (!candidatePath.toLowerCase().endsWith('.md')) {
    candidatePath = `${candidatePath}.md`;
  }

  const absolutePath = path.resolve(candidatePath);
  const displayPath = path.relative(projectRoot, absolutePath) || absolutePath;

  await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });

  return { absolutePath, displayPath };
}

export const exportCommand: SlashCommand = {
  name: 'export',
  description: 'Export the current conversation as a markdown file',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<MessageActionReturn> => {
    const { config } = context.services;

    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const projectRoot = config.getProjectRoot();
    const historyItems = context.ui.getHistory();
    const pendingItem = context.ui.pendingItem;

    if (historyItems.length === 0 && !pendingItem) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to export.',
      };
    }

    const metadata: ExportMetadata = {
      model: config.getModel(),
      sessionId: config.getSessionId(),
      timestamp: new Date(),
    };

    const markdown = buildMarkdown(historyItems, metadata, pendingItem);

    try {
      const { absolutePath, displayPath } = await resolveExportPath(
        projectRoot,
        metadata.timestamp,
        args,
      );

      await fsPromises.writeFile(absolutePath, `${markdown}\n`, 'utf8');

      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation exported to ${displayPath}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to export conversation: ${message}`,
      };
    }
  },
};
