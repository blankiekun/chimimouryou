/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { epubSeries } from './epub-series';

/** The metas as extract-epub.ts parses them. */
function metas(xml: string, prefix = '') {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(
    `<${prefix}package><${prefix}metadata>${xml}</${prefix}metadata></${prefix}package>`
  );

  return parsed[`${prefix}package`][`${prefix}metadata`][`${prefix}meta`];
}

describe('epubSeries', () => {
  it('reads an EPUB 3 collection with its position', () => {
    expect(
      epubSeries(
        metas(`
          <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
          <meta property="belongs-to-collection" id="c01">86―エイティシックス―</meta>
          <meta refines="#c01" property="collection-type">series</meta>
          <meta refines="#c01" property="group-position">2</meta>`)
      )
    ).toEqual({ series: '86―エイティシックス―', seriesIndex: 2 });
  });

  it('skips collections that are not series, then reads Calibre metas', () => {
    expect(
      epubSeries(
        metas(
          `<opf:meta property="belongs-to-collection" id="set">Box set</opf:meta>
          <opf:meta refines="#set" property="collection-type">set</opf:meta>
          <opf:meta name="calibre:series" content="狼と香辛料"/>
          <opf:meta name="calibre:series_index" content="1.5"/>`,
          'opf:'
        )
      )
    ).toEqual({ series: '狼と香辛料', seriesIndex: 1.5 });
  });

  it('keeps a series without a usable index, and nothing without one', () => {
    expect(
      epubSeries(
        metas(`<meta name="calibre:series" content="本好きの下剋上"/>
          <meta name="calibre:series_index" content="x"/>`)
      )
    ).toEqual({ series: '本好きの下剋上' });
    expect(epubSeries(metas(`<meta property="belongs-to-collection">1984</meta>`))).toEqual({
      series: '1984'
    });
    expect(epubSeries(metas(`<meta name="cover" content="img"/>`))).toEqual({});
    expect(epubSeries(undefined)).toEqual({});
  });
});
