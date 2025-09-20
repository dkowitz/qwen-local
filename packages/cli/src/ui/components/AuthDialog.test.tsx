/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthDialog } from './AuthDialog.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@qwen-code/qwen-code-core';
import { renderWithProviders } from '../../test-utils/render.js';

function createSettings(selectedType?: AuthType | undefined): LoadedSettings {
  return new LoadedSettings(
    {
      settings: {
        security: { auth: { selectedType } },
        ui: { customThemes: {} },
        mcpServers: {},
      },
      path: '',
    },
    { settings: {}, path: '' },
    { settings: { ui: { customThemes: {} }, mcpServers: {} }, path: '' },
    { settings: { ui: { customThemes: {} }, mcpServers: {} }, path: '' },
    [],
    true,
    new Set(),
  );
}

describe('AuthDialog', () => {
  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
    delete process.env['OPENAI_MODEL'];
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('renders an initial error message when provided', () => {
    const settings = createSettings(undefined);
    const { lastFrame } = renderWithProviders(
      <AuthDialog
        onSelect={() => {}}
        settings={settings}
        initialErrorMessage="Configuration error"
      />,
    );

    expect(lastFrame()).toContain('Configuration error');
  });

  it('shows the OpenAI-compatible option by default', () => {
    const settings = createSettings(undefined);
    const { lastFrame } = renderWithProviders(
      <AuthDialog onSelect={() => {}} settings={settings} />,
    );

    expect(lastFrame()).toContain('OpenAI-compatible (LM Studio default)');
  });

  it('prevents exiting without selecting an auth method', async () => {
    const onSelect = vi.fn();
    const settings = createSettings(undefined);
    const { lastFrame, stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );

    stdin.write('\u001b'); // ESC
    await wait();

    expect(lastFrame()).toContain(
      'You must select an auth method to proceed. Press Ctrl+C again to exit.',
    );
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
  });

  it('opens the OpenAI key prompt when no credentials are configured', async () => {
    const onSelect = vi.fn();
    const settings = createSettings(undefined);
    const { lastFrame, stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );

    stdin.write('\r'); // Enter to select the only option
    await wait();

    expect(lastFrame()).toContain('OpenAI Configuration Required');
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
  });

  it('selects OpenAI authentication when credentials are present', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    process.env['OPENAI_BASE_URL'] = 'http://127.0.0.1:1234/v1';

    const onSelect = vi.fn();
    const settings = createSettings(undefined);
    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );

    stdin.write('\r');
    await wait();

    expect(onSelect).toHaveBeenCalledWith(AuthType.USE_OPENAI, SettingScope.User);
    unmount();
  });

  it('allows exiting when an auth method is already selected', async () => {
    const onSelect = vi.fn();
    const settings = createSettings(AuthType.USE_OPENAI);
    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );

    stdin.write('\u001b');
    await wait();

    expect(onSelect).toHaveBeenCalledWith(undefined, SettingScope.User);
    unmount();
  });
});
