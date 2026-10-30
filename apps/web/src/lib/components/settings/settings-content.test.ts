/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A phone in the standalone edition: the analysis tools can't run here.
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$lib/data/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/data/env')>()),
  standalone: true
}));
vi.mock('$lib/data/analysis/analysis-tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/data/analysis/analysis-tools')>()),
  analysisToolsSupported: () => false
}));
// Settings sync pulls in the whole store; not under test here (settings-account.test.ts).
vi.mock('$lib/data/account/account-settings-sync', () => ({
  settingsSyncState$: new BehaviorSubject({ state: 'idle' }),
  syncAccountSettings: vi.fn()
}));

const { generatedFurigana$ } = await import('$lib/data/store');
const { default: SettingsContent } = await import('./settings-content.svelte');

describe('SettingsContent on a phone', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Bug (#302): a reading-help switch synced on from a desktop is greyed out on a phone, so it
  // can't be turned off there.
  it('lets a synced-on Generated furigana switch be turned off, then locks it', async () => {
    const target = document.createElement('div');

    document.body.append(target);
    generatedFurigana$.next(true);
    new SettingsContent({ target, props: { storageSources: [] } });

    const toggle = () =>
      target.querySelector<HTMLButtonElement>('[role=switch][aria-label="Generated furigana"]')!;
    const fieldset = () => toggle().closest('fieldset')!;

    expect(fieldset().disabled).toBe(false);
    toggle().click();
    await vi.waitFor(() => expect(generatedFurigana$.getValue()).toBe(false));
    await vi.waitFor(() => expect(fieldset().disabled).toBe(true));
  });
});
