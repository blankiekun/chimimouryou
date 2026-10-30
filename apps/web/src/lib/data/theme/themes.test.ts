/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import { contrastIssues, contrastRatio, parseSimpleColor } from '$lib/data/theme/contrast';
import {
  builtInThemes,
  defaultDarkThemeId,
  defaultLightThemeId,
  parseThemeDefinition,
  resolveTheme
} from '$lib/data/theme/themes';
import { themeTokens } from '$lib/data/theme/theme-tokens';

describe('themes', () => {
  it('defaults to chimi-light and chimi-dark', () => {
    expect(resolveTheme(defaultLightThemeId, {})).toMatchObject({
      name: 'Chimi Light',
      dark: false
    });
    expect(resolveTheme(defaultDarkThemeId, {})).toMatchObject({
      name: 'Chimi Dark',
      dark: true
    });
    expect(resolveTheme('no-such-theme', {}).id).toBe(defaultLightThemeId);
  });

  it('gives every theme a value for every token', () => {
    builtInThemes.forEach(({ id }) => {
      const { colors } = resolveTheme(id, {});
      themeTokens.forEach(({ token }) => expect(colors[token], `${id} ${token}`).toBeTruthy());
    });
  });

  it('fills tokens added later into custom themes made before them', () => {
    const old = { id: 'old-theme', name: 'Old', extends: 'dark', colors: { accent: '#ff00aa' } };
    const { colors } = resolveTheme(old.id, { [old.id]: old });

    expect(colors.accent).toBe('#ff00aa');
    expect(colors.toggleOn).toBe('var(--accent-color)');
    expect(colors.difficulty3).toBe(resolveTheme('dark', {}).colors.difficulty3);
  });

  it('accepts the new tokens in imported themes', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    expect(parseThemeDefinition({ name: 'X', colors: { progressFill: 'red' } }).colors).toEqual({
      progressFill: 'red'
    });
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    const black = parseSimpleColor('#000')!;
    const white = parseSimpleColor('rgb(255, 255, 255)')!;

    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(parseSimpleColor('rgba(0, 0, 0, 0)')!, white)).toBeCloseTo(1, 5);
  });

  // Dev-time check: every built-in theme meets WCAG AA for its main text pairs.
  it('keeps built-in themes readable', () => {
    const report = builtInThemes.flatMap(({ id }) =>
      contrastIssues(resolveTheme(id, {}).colors).map(
        (issue) => `${id}: ${issue.foreground} on ${issue.background} is ${issue.ratio}:1`
      )
    );

    expect(report, 'Below WCAG AA (4.5:1)').toEqual([]);
  });

  // The reader panel's current Contents row (accentStrong) and the header's ち mark (accent).
  it('keeps the spot colour readable on the panel and header', () => {
    const report = builtInThemes.flatMap(({ id }) => {
      const { colors } = resolveTheme(id, {});
      const page = parseSimpleColor(colors.background)!;
      // Translucent panels and headers sit on the page.
      const on = (fg: string, bg: string) => {
        const back = parseSimpleColor(bg)!;
        const mix = (a: number, b: number) => a * back.a + b * (1 - back.a);
        const solid = {
          r: mix(back.r, page.r),
          g: mix(back.g, page.g),
          b: mix(back.b, page.b),
          a: 1
        };
        return contrastRatio(parseSimpleColor(fg)!, solid);
      };
      return [
        ['accentStrong on panelBackground', on(colors.accentStrong, colors.panelBackground), 4.5],
        ['accent on headerBackground', on(colors.accent, colors.headerBackground), 3]
      ]
        .filter(([, ratio, min]) => (ratio as number) < (min as number))
        .map(([pair, ratio]) => `${id}: ${pair} is ${(ratio as number).toFixed(2)}:1`);
    });

    expect(report).toEqual([]);
  });

  it('keeps avatar text readable on every avatar colour', () => {
    const report = builtInThemes.flatMap(({ id }) => {
      const { colors } = resolveTheme(id, {});
      const white = parseSimpleColor(colors.avatarText)!;
      return ([1, 2, 3, 4, 5, 6, 7, 8] as const)
        .map((n) => [n, contrastRatio(white, parseSimpleColor(colors[`avatar${n}`])!)] as const)
        .filter(([, ratio]) => ratio < 4.5)
        .map(([n, ratio]) => `${id}: avatar${n} is ${ratio.toFixed(2)}:1`);
    });

    expect(report).toEqual([]);
  });

  // The rank badge's name is in its colour: AA text on the page (the track then passes 3:1 too).
  it('keeps every rank colour readable on the page', () => {
    const report = builtInThemes.flatMap(({ id }) => {
      const { colors } = resolveTheme(id, {});
      const page = parseSimpleColor(colors.background)!;
      return ([1, 2, 3, 4, 5, 6, 7] as const)
        .map((n) => [n, contrastRatio(parseSimpleColor(colors[`rank${n}`])!, page)] as const)
        .filter(([, ratio]) => ratio < 4.5)
        .map(([n, ratio]) => `${id}: rank${n} is ${ratio.toFixed(2)}:1`);
    });

    expect(report).toEqual([]);
  });

  // The difficulty scale runs from accent to text: both ends need 3:1 (non-text) on the page.
  it('keeps the difficulty scale visible', () => {
    const report = builtInThemes.flatMap(({ id }) => {
      const { colors } = resolveTheme(id, {});
      const page = parseSimpleColor(colors.background)!;
      return (['accent', 'text'] as const)
        .map((token) => [token, contrastRatio(parseSimpleColor(colors[token])!, page)] as const)
        .filter(([, ratio]) => ratio < 3)
        .map(([token, ratio]) => `${id}: ${token} is ${ratio.toFixed(2)}:1`);
    });

    expect(report).toEqual([]);
  });

  // The unknown-word underline (accent unless a theme sets it) is non-text: 3:1 on the page.
  it('keeps the unknown-word underline visible on the book', () => {
    const report = builtInThemes.flatMap(({ id }) => {
      const { colors } = resolveTheme(id, {});
      const color =
        colors.unknownWord === 'var(--accent-color)' ? colors.accent : colors.unknownWord;
      const ratio = contrastRatio(
        parseSimpleColor(color)!,
        parseSimpleColor(colors.readerBackground)!
      );
      return ratio < 3 ? [`${id}: unknownWord is ${ratio.toFixed(2)}:1`] : [];
    });

    expect(report).toEqual([]);
  });
});
