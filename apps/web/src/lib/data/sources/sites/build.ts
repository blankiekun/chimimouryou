/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The volume plan and an EPUB 3 of fetched chapters (server/import/sources/{planner,build}.py in
 * the browser): vertical right-to-left, a nav, one XHTML per chapter. clean() keeps a whitelist of
 * tags without attributes, so a site's scripts, styles, links and images never reach the book.
 */

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

export const VOLUME_SIZE = 50;

/** [{number, first, last}] covering chapters 1..chapters, `size` per volume. */
export function plan(chapters: number, size = VOLUME_SIZE) {
  const volumes: { number: number; first: number; last: number }[] = [];
  for (let first = 1; first <= chapters; first += size) {
    volumes.push({ number: volumes.length + 1, first, last: Math.min(first + size - 1, chapters) });
  }
  return volumes;
}

const ALLOWED = new Set([
  'p',
  'br',
  'ruby',
  'rb',
  'rt',
  'rp',
  'em',
  'strong',
  'b',
  'i',
  'sub',
  'sup'
]);

export function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanNode(node: Node): string {
  if (node.nodeType === 3) return escapeXml(node.textContent || '');
  if (node.nodeType !== 1) return '';
  const tag = (node as Element).localName;
  const inner = [...node.childNodes].map(cleanNode).join('');
  // Templates hold their content apart (no childNodes), so script-like elements drop it all.
  if (
    ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg', 'math'].includes(tag)
  ) {
    return '';
  }
  if (!ALLOWED.has(tag)) return inner;
  return tag === 'br' ? '<br/>' : `<${tag}>${inner}</${tag}>`;
}

/** Well-formed XHTML body content from a site's chapter HTML. */
export function clean(html: string) {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  return [...body.childNodes].map(cleanNode).join('');
}

/** A text fragment's text: tags dropped, entities decoded. */
export function plainText(fragment: string) {
  return (
    new DOMParser().parseFromString(`<body>${fragment}</body>`, 'text/html').body.textContent || ''
  ).trim();
}

const CSS = `html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }
body { margin: 0; line-height: 1.8; }
h2 { font-size: 1.2em; margin: 0 0 0 2em; }
p { margin: 0; }
em { font-style: normal; -webkit-text-emphasis: sesame; text-emphasis: sesame; }
`;

function xhtml(title: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>
`;
}

export interface EpubInput {
  title: string;
  authors: string;
  series: string;
  seriesIndex: number;
  identifier: string;
  /** xhtml from clean() */
  chapters: { title: string; xhtml: string }[];
}

/** An EPUB File named `<title>.epub`. */
export async function epub(book: EpubInput) {
  const names = book.chapters.map((_, n) => `c${String(n + 1).padStart(4, '0')}.xhtml`);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapeXml(book.identifier)}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
<dc:creator>${escapeXml(book.authors)}</dc:creator>
<dc:language>ja</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
<meta name="calibre:series" content="${escapeXml(book.series)}"/>
<meta name="calibre:series_index" content="${book.seriesIndex}"/>
<meta name="primary-writing-mode" content="vertical-rl"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${names.map((name, n) => `<item id="c${n + 1}" href="${name}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine page-progression-direction="rtl">
${names.map((_, n) => `<itemref idref="c${n + 1}"/>`).join('\n')}
</spine>
</package>
`;
  const toc = book.chapters
    .map((c, n) => `<li><a href="${names[n]}">${escapeXml(c.title || `${n + 1}`)}</a></li>`)
    .join('\n');
  const nav = xhtml(
    book.title,
    `<nav epub:type="toc" id="toc"><h1>${escapeXml(book.title)}</h1><ol>\n${toc}\n</ol></nav>`
  );
  const zip = new ZipWriter(new BlobWriter('application/epub+zip'));
  await zip.add('mimetype', new TextReader('application/epub+zip'), {
    level: 0,
    extendedTimestamp: false
  });
  const files: [string, string][] = [
    [
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
    ],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/style.css', CSS],
    ...book.chapters.map((c, n): [string, string] => [
      `OEBPS/${names[n]}`,
      xhtml(c.title || book.title, (c.title ? `<h2>${escapeXml(c.title)}</h2>` : '') + c.xhtml)
    ])
  ];
  for (const [name, text] of files) await zip.add(name, new TextReader(text));
  return new File([await zip.close()], `${book.title}.epub`, { type: 'application/epub+zip' });
}

const MAGIC: [number[], string][] = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif']
];

/** JPEG, PNG, GIF or WebP by their first bytes, else ''. */
export function imageType(data: ArrayBuffer) {
  const bytes = new Uint8Array(data.slice(0, 12));
  const text = String.fromCharCode(...bytes);
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return MAGIC.find(([magic]) => magic.every((b, i) => bytes[i] === b))?.[1] ?? '';
}
