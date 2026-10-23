/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { findSettingsSection, sectionFromUrl } from './settings-sections';

const section = (path: string) => sectionFromUrl(new URL(path, 'http://books.lan'))?.id;

describe('settings sections', () => {
  it('reads the section from the hash, ?section= and old ?tab= links', () => {
    expect(section('/settings?section=reader#reader-writing')).toBe('reader-writing');
    expect(section('/settings?section=anki')).toBe('anki-connect');
    expect(section('/settings?tab=AI')).toBe('ai-ask');
  });

  it('sends links to the old Custom Themes section to Themes', () => {
    expect(section('/settings?section=general#general-custom-themes')).toBe('general-theme');
    expect(section('/settings?tab=Themes')).toBe('general-theme');
  });

  it('numbers sections within their area', () => {
    expect(findSettingsSection('general-account')?.number).toBe(1);
    expect(findSettingsSection('reader-layout')?.number).toBe(3);
  });
});
