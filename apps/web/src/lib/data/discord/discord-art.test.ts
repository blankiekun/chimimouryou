/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { artKinds, artSvg, ringSteps } from './discord-art';
import { buildActivity, ringKey, type DiscordActivityTemplate } from './discord-template';

const template: DiscordActivityTemplate = {
  show: true,
  name: 'Reading {title}',
  details: '{title}',
  detailsUrl: '',
  state: '',
  stateUrl: '',
  largeImage: 'logo',
  largeCustom: '',
  largeText: '',
  smallImage: 'ring',
  smallCustom: '',
  smallText: '{percent}',
  timestamp: 'none',
  party: false,
  partyCurrent: 'chapterNumber',
  partyMax: 'chapterCount',
  buttons: [],
  privacyText: 'Reading a book'
};
const times = { now: 1_000_000 };
const values = { title: '薬屋のひとりごと', percent: '47%' };

describe('ringKey', () => {
  it('rounds down to 5% steps', () => {
    expect(ringKey('0%')).toBe('ring-0');
    expect(ringKey('4%')).toBe('ring-0');
    expect(ringKey('5%')).toBe('ring-5');
    expect(ringKey('99%')).toBe('ring-95');
    expect(ringKey('100%')).toBe('ring-100');
    expect(ringKey('')).toBeUndefined();
    expect(ringKey()).toBeUndefined();
  });
});

describe('small ring and kind images', () => {
  it('puts the hub URL of the ring or kind art in small_image', () => {
    expect(buildActivity(template, values, { times })?.assets).toEqual({
      large_image: 'applogo',
      small_image: 'https://chimi-hub.blankiekun.workers.dev/v1/art/ring-45.png',
      small_text: '47%'
    });
    expect(
      buildActivity({ ...template, smallImage: 'kind' }, values, { times, kind: 'vn' })?.assets
        ?.small_image
    ).toBe('https://chimi-hub.blankiekun.workers.dev/v1/art/kind-vn.png');
  });

  it('drops them when there is nothing to show', () => {
    expect(buildActivity(template, { title: 'x' }, { times })?.assets?.small_image).toBeUndefined();
    expect(
      buildActivity({ ...template, smallImage: 'kind' }, values, { times, kind: 'idle' })?.assets
        ?.small_image
    ).toBeUndefined();
  });

  it('sends only the logo when private', () => {
    expect(
      buildActivity({ ...template, smallImage: 'kind' }, values, {
        times,
        kind: 'book',
        private: true
      })?.assets
    ).toEqual({ large_image: 'applogo' });
  });
});

describe('artSvg', () => {
  it('draws all 25 keys and nothing else', () => {
    const keys = [...ringSteps.map((step) => `ring-${step}`), ...artKinds.map((k) => `kind-${k}`)];

    expect(keys).toHaveLength(25);
    for (const key of keys) expect(artSvg(key)).toMatch(/^<svg [^]*<\/svg>$/);
    expect(artSvg('ring-7')).toBeUndefined();
    expect(artSvg('kind-idle')).toBeUndefined();
    expect(artSvg('kind-constructor')).toBeUndefined();
    expect(artSvg('applogo')).toBeUndefined();
  });
});
