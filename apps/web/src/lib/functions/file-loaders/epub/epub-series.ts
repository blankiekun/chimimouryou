/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A parsed OPF `<meta>`: EPUB 2 name/content, EPUB 3 property/refines with its text. */
type OpfMeta = Record<string, unknown>;

function text(value: unknown): string {
  if (value && typeof value === 'object' && '#text' in value) return text(value['#text']);

  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function index(value: string) {
  const number = value ? Number(value) : NaN;

  return Number.isFinite(number) ? number : undefined;
}

function withIndex(series: string, seriesIndex: number | undefined) {
  return seriesIndex === undefined ? { series } : { series, seriesIndex };
}

/**
 * The series an EPUB names in its package metadata: an EPUB 3 `belongs-to-collection` (of type
 * series, or untyped) with its `group-position`, else Calibre's `calibre:series` and
 * `calibre:series_index` metas. Not part of upstream.
 */
export function epubSeries(metas: object | object[] | undefined): {
  series?: string;
  seriesIndex?: number;
} {
  const list = (Array.isArray(metas) ? metas : metas ? [metas] : []).filter(
    (meta) => meta && typeof meta === 'object'
  ) as OpfMeta[];
  const refining = (id: unknown, property: string) =>
    id
      ? text(list.find((meta) => meta['@_refines'] === `#${id}` && meta['@_property'] === property))
      : '';

  for (const meta of list) {
    if (meta['@_property'] !== 'belongs-to-collection') continue;

    const series = text(meta);
    const type = refining(meta['@_id'], 'collection-type');

    if (series && (!type || type === 'series')) {
      return withIndex(series, index(refining(meta['@_id'], 'group-position')));
    }
  }

  const named = (name: string) => text(list.find((meta) => meta['@_name'] === name)?.['@_content']);
  const series = named('calibre:series');

  return series ? withIndex(series, index(named('calibre:series_index'))) : {};
}
