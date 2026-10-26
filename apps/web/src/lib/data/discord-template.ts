/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The Discord plugin's templates: {variables} filled in from what is open, cut to Discord's
 * limits (the same as the Anki add-on's activity.py and the hub), and the finished activity the
 * add-on takes. Pure functions, no I/O. Not part of upstream.
 */

/** Discord's limits, as apps/anki-discord/chimimouryou_discord/activity.py clamps them */
export const discordLimits = {
  text: 128,
  minText: 2,
  label: 32,
  url: 256,
  buttonUrl: 512,
  buttons: 2
};

/** The Discord app's art asset key for the app logo (App logo, and the fallback for covers) */
export const logoKey = 'applogo';

export const variableGroups = {
  book: ['title', 'author', 'series', 'volume', 'chapter', 'kind', 'difficulty'],
  progress: [
    'chapterNumber',
    'chapterCount',
    'percent',
    'page',
    'pageCount',
    'charsRead',
    'timeLeftBook',
    'timeLeftChapter'
  ],
  today: ['charsToday', 'timeToday', 'speed'],
  you: ['wordsKnown', 'streak']
} as const;

export type VariableGroup = keyof typeof variableGroups;
export type VariableName = (typeof variableGroups)[VariableGroup][number];
export type DiscordValues = Partial<Record<VariableName, string>>;

export const variableNames: VariableName[] = Object.values(variableGroups).flat();

/** Variables a party size can count with */
export const partyVariables: VariableName[] = [
  'chapterNumber',
  'chapterCount',
  'page',
  'pageCount'
];

export type DiscordKind = 'book' | 'manga' | 'vn' | 'idle';
export type LargeImage = 'logo' | 'cover' | 'custom';
// shortcut: no "Progress ring": the add-on can only send image keys or https URLs and the
// Discord app has no ring images; add ring assets (e.g. ring-0…ring-100) to offer it.
export type SmallImage = 'none' | 'logo' | 'custom';
export type TimestampMode = 'none' | 'session' | 'opened' | 'chapterLeft' | 'bookLeft';

export interface DiscordButton {
  label: string;
  url: string;
}

export interface DiscordActivityTemplate {
  show: boolean;
  /** Next to your name (Discord's activity name) */
  name: string;
  /** First line */
  details: string;
  detailsUrl: string;
  /** Second line */
  state: string;
  stateUrl: string;
  largeImage: LargeImage;
  largeCustom: string;
  largeText: string;
  smallImage: SmallImage;
  smallCustom: string;
  smallText: string;
  timestamp: TimestampMode;
  party: boolean;
  partyCurrent: VariableName;
  partyMax: VariableName;
  buttons: DiscordButton[];
  /** Replaces the status for books hidden from friends (and every book with Hide titles) */
  privacyText: string;
}

/** The activity the add-on takes (SPEC.md) */
export interface DiscordActivity {
  name?: string;
  details?: string;
  details_url?: string;
  state?: string;
  state_url?: string;
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  timestamps?: { start?: number; end?: number };
  party?: { size: [number, number] };
  buttons?: DiscordButton[];
}

const variablePattern = /\{(\w+)\}/g;
// Marks an empty value while tidying; never typed by a reader.
const empty = '\u0000';
const separator = '[·・|,、/:：\\-–—]';
const beforeEmpty = new RegExp(`[ \\t]*(?:${separator}[ \\t]*)?${empty}`, 'g');
const edges = new RegExp(`^(?:\\s|${separator})+|(?:\\s|${separator})+$`, 'g');

export const isVariable = (name: string): name is VariableName =>
  (variableNames as string[]).includes(name);

export const length = (text: string) => [...text].length;

/** Cut to `max` characters (code points, like the add-on), with "…" when cut */
export function clampText(text: string, max = discordLimits.text) {
  const chars = [...text];

  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/** {names} in the template that aren't variables */
export function unknownVariables(template: string) {
  return [...template.matchAll(variablePattern)]
    .map((match) => match[1])
    .filter((name) => !isVariable(name));
}

/** The variables a template uses */
export function usedVariables(template: string) {
  return [...template.matchAll(variablePattern)].map((match) => match[1]).filter(isVariable);
}

function distance(a: string, b: string) {
  let row = [...Array(b.length + 1).keys()];

  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];

    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** The variable an unknown name was probably meant to be, if one is close */
export function suggestVariable(name: string) {
  const lower = name.toLowerCase();
  const [best] = variableNames
    .map((variable) => ({ variable, score: distance(lower, variable.toLowerCase()) }))
    .sort((a, b) => a.score - b.score);

  return best.score <= Math.max(2, Math.floor(name.length / 3)) ? best.variable : undefined;
}

/**
 * The template with its variables filled in. An empty value is left out with the separator
 * before it (or after it, at the start), so "{title} · {author}" without an author is "{title}".
 * Unknown {names} stay as typed (`unknownVariables` reports them).
 */
export function renderTemplate(template: string, values: DiscordValues) {
  return template
    .replace(variablePattern, (match, name: string) =>
      isVariable(name) ? values[name]?.replace(/\s+/g, ' ').trim() || empty : match
    )
    .replace(beforeEmpty, '')
    .replace(/[(（[]\s*[)）\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(edges, '');
}

export const isHttps = (url: string) => /^https:\/\/[^\s/?#]+\.[^\s]*$/i.test(url);
const isImageKey = (value: string) => /^[\w-]{1,64}$/.test(value);

/** What the editor marks in a template field */
export interface FieldCheck {
  unknown: string[];
  /** Characters after filling in */
  length: number;
  /** Characters over the limit after filling in (cut by Discord) */
  over: number;
  /** A link that isn't https:// once filled in */
  badLink: boolean;
}

export function checkField(
  template: string,
  values: DiscordValues,
  { link = false, max }: { link?: boolean; max?: number } = {}
): FieldCheck {
  max ??= link ? discordLimits.url : discordLimits.text;
  const text = renderTemplate(template, values);

  return {
    unknown: unknownVariables(template),
    length: length(text),
    over: Math.max(0, length(text) - max),
    badLink: link && !!text && !isHttps(text)
  };
}

/** Template fields of an activity, with whether they hold a link */
export function templateFields(template: DiscordActivityTemplate) {
  return [
    { key: 'name', text: template.name, link: false },
    { key: 'details', text: template.details, link: false },
    { key: 'detailsUrl', text: template.detailsUrl, link: true },
    { key: 'state', text: template.state, link: false },
    { key: 'stateUrl', text: template.stateUrl, link: true },
    { key: 'largeText', text: template.largeText, link: false },
    { key: 'smallText', text: template.smallText, link: false },
    ...template.buttons.map((button, i) => ({ key: `button${i}`, text: button.url, link: true }))
  ];
}

/** Problems that keep the activity from being sent: unknown variables and links that aren't https */
export function activityProblems(template: DiscordActivityTemplate, values: DiscordValues) {
  const fields = templateFields(template).map((field) => ({
    ...field,
    check: checkField(field.text, values, { link: field.link })
  }));

  return fields.filter((field) => field.check.unknown.length || field.check.badLink);
}

/** Times a timestamp can count from or to (ms since the epoch, or seconds left) */
export interface DiscordTimes {
  now: number;
  session?: number;
  opened?: number;
  chapterLeft?: number;
  bookLeft?: number;
}

function text(template: string, values: DiscordValues, max = discordLimits.text) {
  const filled = clampText(renderTemplate(template, values), max);

  return length(filled) >= discordLimits.minText ? filled : undefined;
}

function linkText(template: string, values: DiscordValues, max = discordLimits.url) {
  const filled = renderTemplate(template, values);

  return isHttps(filled) && length(filled) <= max ? filled : undefined;
}

function image(choice: string, custom: string, cover?: string) {
  if (choice === 'logo') return logoKey;
  if (choice === 'cover') return cover && isHttps(cover) ? cover : logoKey;
  if (choice === 'custom') {
    const value = custom.trim();

    return isHttps(value) || isImageKey(value) ? value : undefined;
  }
  return undefined;
}

function timestamps(mode: TimestampMode, times: DiscordTimes) {
  const start = mode === 'session' ? times.session : mode === 'opened' ? times.opened : undefined;
  const left =
    mode === 'chapterLeft' ? times.chapterLeft : mode === 'bookLeft' ? times.bookLeft : undefined;

  if (start) return { start };
  if (left !== undefined && left > 0) return { end: times.now + Math.round(left * 1000) };
  return undefined;
}

const count = (value?: string) => {
  const digits = value?.replace(/[^\d]/g, '');

  return digits ? Number(digits) : NaN;
};

const prune = <T extends object>(object: T): T | undefined => {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);

  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

export interface BuildOptions {
  times: DiscordTimes;
  /** A public https cover of the open book, if one exists */
  cover?: string;
  /** Hidden from friends, or Hide titles everywhere: only the privacy text and the logo */
  private?: boolean;
}

/** The finished activity, cut to Discord's limits; undefined when nothing is left to show. */
export function buildActivity(
  template: DiscordActivityTemplate,
  values: DiscordValues,
  options: BuildOptions
): DiscordActivity | undefined {
  const time = timestamps(template.timestamp, options.times);

  if (options.private) {
    return {
      name: text(template.privacyText, {}) ?? 'Reading',
      assets: { large_image: logoKey },
      ...(time ? { timestamps: time } : {})
    };
  }

  const largeImage = image(template.largeImage, template.largeCustom, options.cover);
  const smallImage = image(template.smallImage, template.smallCustom);
  const current = count(values[template.partyCurrent]);
  const max = count(values[template.partyMax]);
  const buttons = template.buttons
    .map((button) => ({
      label: text(button.label, {}, discordLimits.label) ?? '',
      url: linkText(button.url, values, discordLimits.buttonUrl) ?? ''
    }))
    .filter((button) => button.label && button.url)
    .slice(0, discordLimits.buttons);

  const activity = prune<DiscordActivity>({
    name: text(template.name, values),
    details: text(template.details, values),
    details_url: linkText(template.detailsUrl, values),
    state: text(template.state, values),
    state_url: linkText(template.stateUrl, values),
    assets: prune({
      large_image: largeImage,
      large_text: largeImage ? text(template.largeText, values) : undefined,
      small_image: smallImage,
      small_text: smallImage ? text(template.smallText, values) : undefined
    }),
    timestamps: time,
    party:
      template.party && current >= 1 && current <= max
        ? { size: [current, max] as [number, number] }
        : undefined,
    buttons: buttons.length ? buttons : undefined
  });

  // Discord needs one of the text lines; a link without its line goes too.
  if (!activity?.name && !activity?.details && !activity?.state) return undefined;
  if (!activity.details) delete activity.details_url;
  if (!activity.state) delete activity.state_url;
  return activity;
}

/** The same activity without its times: what tells a real change from a clock tick */
export function activityKey(activity: DiscordActivity | undefined) {
  if (!activity) return '';

  const { timestamps: _times, ...rest } = activity;

  return JSON.stringify(rest);
}

/** Discord's clock under an activity: "02:14" or "1:02:14" elapsed since start, else left until end */
export function activityClock(
  timestamps: DiscordActivity['timestamps'],
  now: number
): { mode: 'elapsed' | 'left'; text: string } | undefined {
  const { start, end } = timestamps ?? {};

  if (!start && !end) return undefined;

  const seconds = Math.max(0, Math.round((start ? now - start : end! - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    mode: start ? 'elapsed' : 'left',
    text:
      seconds >= 3600
        ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
        : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
  };
}
