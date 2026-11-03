/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import { isOPFType, type EpubContent, type EpubOPFContent } from './types';
import { assertMemberSize } from '../htmlz/extract-htmlz';

import type { Entry } from '@zip.js/zip.js';
import { XMLParser } from 'fast-xml-parser';
import path from 'path-browserify';

/** What generate-epub-html and generate-epub-style-sheet read, besides the spine and the .ncx */
const textMediaTypes = new Set(['application/xhtml+xml', 'text/html', 'text/css']);

export default async function extractEpub(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  // get all entries from the zip
  const entries = await reader.getEntries();

  const result: Record<string, string | Blob> = {};
  let contentsDirectory = '';
  let contents!: EpubContent | EpubOPFContent;
  if (entries.length) {
    const fileMap = entries.reduce<Record<string, Entry>>((acc, cur) => {
      acc[cur.filename] = cur;
      return acc;
    }, {});

    assertMemberSize(fileMap['META-INF/container.xml']);

    const containerXml = await fileMap['META-INF/container.xml'].getData!(new TextWriter());
    const parser = new XMLParser({
      ignoreAttributes: false,
      // Titles are text, even 1984 or 007.
      parseTagValue: false,
      // A manifest with one item parses to an object, not a list; the loaders map over it.
      isArray: (name) => name === 'item' || name === 'opf:item'
    });
    const container = parser.parse(containerXml);
    const rootFiles = container.container.rootfiles.rootfile;
    const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;

    const contentOpfFilename = rootFile['@_full-path'];

    assertMemberSize(fileMap[contentOpfFilename]);

    const contentsXml = await fileMap[contentOpfFilename].getData!(new TextWriter());
    result[contentOpfFilename] = contentsXml;

    contentsDirectory = path.dirname(contentOpfFilename);

    contents = parser.parse(contentsXml);

    const spineIds = new Set(
      [
        isOPFType(contents)
          ? contents['opf:package']['opf:spine']['opf:itemref']
          : contents.package.spine.itemref
      ]
        .flat()
        .map((ref) => ref['@_idref'])
    );

    await Promise.all(
      (isOPFType(contents)
        ? contents['opf:package']['opf:manifest']['opf:item']
        : contents.package.manifest.item
      ).map(async (item) => {
        const fileRelativePath = item['@_href'];
        const entry =
          fileMap[path.join(contentsDirectory, fileRelativePath)] ??
          fileMap[path.join(contentsDirectory, decodedHref(fileRelativePath))];

        if (!entry) {
          // A lost chapter must not import quietly; a lost font or picture can.
          if (spineIds.has(item['@_id'])) {
            throw new Error(`item ${fileRelativePath} not found`);
          }
          return;
        }

        if (entry.getData && !entry.directory) {
          const mediaType: string = item['@_media-type'] ?? '';
          const isImage = mediaType.startsWith('image/');

          // Fonts, audio and video are never used: left in the zip, whatever their size.
          if (
            !isImage &&
            !spineIds.has(item['@_id']) &&
            !textMediaTypes.has(mediaType) &&
            !fileRelativePath.endsWith('.ncx')
          ) {
            return;
          }

          assertMemberSize(entry);
          result[fileRelativePath] = isImage
            ? await entry.getData(new BlobWriter(mediaType))
            : await entry.getData(new TextWriter());
        }
      })
    );
  }

  await reader.close();
  return {
    contentsDirectory,
    contents,
    result
  };
}

function decodedHref(href: string) {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}
