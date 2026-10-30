/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  activityKey,
  activityProblems,
  buildActivity,
  checkField,
  clampText,
  renderTemplate,
  halfWidth,
  suggestVariable,
  unknownVariables,
  type DiscordActivityTemplate
} from './discord-template';

const values = {
  title: '薬屋のひとりごと',
  author: '日向夏',
  volume: 'Vol. 1',
  chapter: '第三話 白粉',
  percent: '21%',
  chapterNumber: '3',
  chapterCount: '12'
};

const template: DiscordActivityTemplate = {
  show: true,
  name: 'Reading {title}',
  details: '{title} {volume} · {author}',
  detailsUrl: '',
  state: '{chapter} · {percent}',
  stateUrl: '',
  largeImage: 'cover',
  largeCustom: '',
  largeText: '',
  smallImage: 'none',
  smallCustom: '',
  smallText: '',
  timestamp: 'session',
  party: true,
  partyCurrent: 'chapterNumber',
  partyMax: 'chapterCount',
  buttons: [],
  privacyText: 'Reading a book'
};

const times = { now: 1_000_000, session: 900_000, bookLeft: 60 };

describe('renderTemplate', () => {
  it('leaves empty values out with their separator', () => {
    expect(renderTemplate('{title} {volume} · {author}', { title: 'A', author: 'B' })).toBe(
      'A · B'
    );
    expect(renderTemplate('{title} · {author}', { title: 'A' })).toBe('A');
    expect(renderTemplate('{title} · {author}', { author: 'B' })).toBe('B');
    expect(renderTemplate('{chapter} · {percent} · {speed}', { chapter: 'C', speed: '9' })).toBe(
      'C · 9'
    );
    expect(renderTemplate('{title} ({volume})', { title: 'A' })).toBe('A');
    expect(renderTemplate('{title}', {})).toBe('');
  });

  it('turns full-width English half-width, keeping Japanese punctuation', () => {
    expect(renderTemplate('{title}', { title: 'Ｒｅ：ゼロ「１２」・本、。' })).toBe(
      'Re:ゼロ「12」・本、。'
    );
    expect(halfWidth('ＡＢＣ！～　')).toBe('ABC!~　');
  });

  it('keeps unknown names as typed and reports them', () => {
    expect(renderTemplate('with {titel}', values)).toBe('with {titel}');
    expect(unknownVariables('{titel} {title} {Title}')).toEqual(['titel', 'Title']);
    expect(suggestVariable('titel')).toBe('title');
    expect(suggestVariable('zzzzzzzz')).toBeUndefined();
  });
});

describe('limits', () => {
  it('cuts long text with an ellipsis, counting code points', () => {
    expect(clampText('a'.repeat(130))).toHaveLength(128);
    expect(clampText('a'.repeat(130)).endsWith('…')).toBe(true);
    expect(clampText('𠮷'.repeat(128))).toBe('𠮷'.repeat(128));
  });

  it('checks fields after filling in', () => {
    expect(checkField('{title}', { title: 'x'.repeat(141) }).over).toBe(13);
    expect(checkField('anilist.co/search?q={title}', values, { link: true }).badLink).toBe(true);
    expect(checkField('https://anilist.co/search?q={title}', values, { link: true }).badLink).toBe(
      false
    );
    expect(checkField('', values, { link: true }).badLink).toBe(false);
  });

  it('counts unknown variables and non-https links as problems', () => {
    const problems = activityProblems(
      {
        ...template,
        name: '{titel}',
        detailsUrl: 'http://x.com',
        buttons: [{ label: 'a', url: 'ftp://b' }]
      },
      values
    );

    expect(problems.map((problem) => problem.key)).toEqual(['name', 'detailsUrl', 'button0']);
  });
});

describe('buildActivity', () => {
  it('makes the activity the add-on takes', () => {
    expect(
      buildActivity(template, values, { times, cover: 'https://s4.anilist.co/c.jpg' })
    ).toEqual({
      name: 'Reading 薬屋のひとりごと',
      details: '薬屋のひとりごと Vol. 1 · 日向夏',
      state: '第三話 白粉 · 21%',
      assets: { large_image: 'https://s4.anilist.co/c.jpg' },
      timestamps: { start: 900_000 },
      party: { size: [3, 12] }
    });
  });

  it('falls back to the logo without a public cover and drops what Discord refuses', () => {
    const activity = buildActivity(
      {
        ...template,
        state: 'x',
        detailsUrl: 'http://insecure.example',
        timestamp: 'bookLeft',
        partyCurrent: 'chapterCount',
        partyMax: 'chapterNumber',
        buttons: [
          { label: 'One', url: 'https://a.example/{title}' },
          { label: 'Two', url: 'nope' },
          { label: 'Three', url: 'https://c.example' },
          { label: 'Four', url: 'https://d.example' }
        ]
      },
      values,
      { times }
    );

    expect(activity?.assets).toEqual({ large_image: 'applogo' });
    expect(activity?.state).toBeUndefined();
    expect(activity?.details_url).toBeUndefined();
    expect(activity?.party).toBeUndefined();
    expect(activity?.timestamps).toEqual({ end: 1_060_000 });
    expect(activity?.buttons).toEqual([
      { label: 'One', url: 'https://a.example/薬屋のひとりごと' },
      { label: 'Three', url: 'https://c.example' }
    ]);
  });

  it('shows only the privacy text and the logo for a private book', () => {
    expect(buildActivity(template, values, { times, private: true })).toEqual({
      name: 'Reading a book',
      assets: { large_image: 'applogo' },
      timestamps: { start: 900_000 }
    });
  });

  it('sends nothing when every line is empty', () => {
    expect(
      buildActivity({ ...template, name: '{author}', details: '', state: '' }, {}, { times })
    ).toBeUndefined();
  });

  it('keys an activity without its times', () => {
    const a = buildActivity(template, values, { times })!;
    const b = buildActivity(template, values, { times: { ...times, session: 1 } })!;

    expect(activityKey(a)).toBe(activityKey(b));
    expect(activityKey(undefined)).toBe('');
  });
});
