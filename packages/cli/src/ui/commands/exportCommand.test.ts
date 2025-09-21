/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { exportCommand } from './exportCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';
import type { HistoryItem } from '../types.js';
import * as fsPromises from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

describe('exportCommand', () => {
  let context: CommandContext;
  let mkdirMock: Mock;
  let writeFileMock: Mock;

  beforeEach(() => {
    vi.useRealTimers();
    mkdirMock = vi.mocked(fsPromises.mkdir);
    writeFileMock = vi.mocked(fsPromises.writeFile);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);

    context = createMockCommandContext({
      services: {
        config: {
          getProjectRoot: () => '/project',
          getModel: () => 'test-model',
          getSessionId: () => 'session-123',
        },
      },
      ui: {
        getHistory: vi.fn(() => []),
        pendingItem: null,
      },
    });
  });

  it('returns an error when config is not available', async () => {
    if (!exportCommand.action) throw new Error('Command has no action');
    const result = await exportCommand.action(
      createMockCommandContext({ services: { config: null } }),
      '',
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    });
  });

  it('returns info message when there is no history to export', async () => {
    if (!exportCommand.action) throw new Error('Command has no action');

    const result = await exportCommand.action(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'No conversation found to export.',
    });
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes markdown export with default path when history exists', async () => {
    if (!exportCommand.action) throw new Error('Command has no action');

    const frozenDate = new Date('2025-01-02T03:04:05.000Z');
    vi.useFakeTimers().setSystemTime(frozenDate);

    const history: HistoryItem[] = [
      { id: 1, type: 'user', text: 'Hello world' },
      { id: 2, type: 'gemini', text: 'Hi there!' },
    ];

    context.ui.getHistory = vi.fn(() => history);

    const result = await exportCommand.action(context, '');

    expect(mkdirMock).toHaveBeenCalledWith(
      '/project/.qwen/conversations',
      { recursive: true },
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [writtenPath, content] = writeFileMock.mock.calls[0];
    expect(writtenPath).toBe(
      '/project/.qwen/conversations/conversation-20250102-030405.md',
    );
    expect(content).toContain('# Conversation Export');
    expect(content).toContain('Hello world');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Conversation exported to .qwen/conversations/conversation-20250102-030405.md',
    });
  });

  it('appends .md extension when custom path is provided', async () => {
    if (!exportCommand.action) throw new Error('Command has no action');

    context.ui.getHistory = vi.fn(() => [
      { id: 1, type: 'user', text: 'Request' } satisfies HistoryItem,
    ]);

    const result = await exportCommand.action(context, 'exports/session-log');

    if (!result || result.type !== 'message') {
      throw new Error('Expected message return');
    }

    expect(writeFileMock).toHaveBeenCalledWith(
      '/project/exports/session-log.md',
      expect.any(String),
      'utf8',
    );
    expect(result.content).toBe('Conversation exported to exports/session-log.md');
  });

  it('reports an error if writing fails', async () => {
    if (!exportCommand.action) throw new Error('Command has no action');

    context.ui.getHistory = vi.fn(() => [
      { id: 1, type: 'user', text: 'Something' } satisfies HistoryItem,
    ]);

    writeFileMock.mockRejectedValueOnce(new Error('disk full'));

    const result = await exportCommand.action(context, '');

    if (!result || result.type !== 'message') {
      throw new Error('Expected message return');
    }

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to export conversation: disk full',
    });
  });
});
