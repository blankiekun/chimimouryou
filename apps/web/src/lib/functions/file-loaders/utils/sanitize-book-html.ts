/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Not part of upstream. Book HTML comes from EPUB files and from the shared sync folder,
 * which other people can write, so it must not run script in the reader. It is
 * parsed in an inert document (nothing loads, no handler fires) and cleaned
 * before it reaches the page. The Content-Security-Policy in vite.config.js
 * is the second line of defence.
 */

/**
 * Elements that run code, load other documents, change how links resolve, or
 * parse differently once scripting is on (noscript & co. are the classic way to
 * smuggle markup past a sanitizer).
 */
const blockedElements = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'base',
  'meta',
  'link',
  'form',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  // SVG animation can set href to a javascript: URL.
  'animate',
  'set'
]);

const urlAttributes = new Set([
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'lowsrc',
  'dynsrc'
]);

// Browsers ignore whitespace and control characters inside the scheme ("java\tscript:").
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const ignoredUrlCharacters = /[\u0000- \u007f-\u009f]/g;
// file: would let the desktop app hand a local or UNC path to the system to open.
const unsafeUrl = /^(?:javascript:|vbscript:|file:|data:(?!image\/))/i;
// data: images stay where they are drawn (books inline pictures); a link to one could open a
// scripted SVG document.
const imageUrlAttributes = new Set(['src', 'poster', 'background', 'lowsrc', 'dynsrc']);

/** A document without a browsing context: parsing into it loads nothing and runs nothing. */
export function createInertDocument() {
  return new DOMParser().parseFromString('<!doctype html><title></title>', 'text/html');
}

/** Removes everything under `root` that could run script, in place. */
export function sanitizeBookElement(root: Element) {
  removeUnsafeMarkup(root);

  // Book HTML is stored as text and parsed again, and serialized HTML can parse into a
  // different tree (MathML or SVG inside tables: mXSS), so clean until a round trip changes nothing.
  for (let pass = 0; pass < 3; pass++) {
    const html = root.innerHTML;

    root.innerHTML = html;
    removeUnsafeMarkup(root);

    if (root.innerHTML === html) return;
  }

  // Still changing: markup built to keep mutating, not a book.
  root.replaceChildren();
}

function removeUnsafeMarkup(root: Element) {
  for (const element of [...root.querySelectorAll('*')]) {
    if (blockedElements.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }

    for (const { name, value } of [...element.attributes]) {
      const lowerName = name.toLowerCase();

      if (
        lowerName.startsWith('on') ||
        lowerName === 'srcdoc' ||
        (urlAttributes.has(lowerName) && isUnsafeUrl(element, lowerName, value))
      ) {
        element.removeAttribute(name);
      }
    }
  }
}

function isUnsafeUrl(element: Element, lowerName: string, value: string) {
  const url = value.replace(ignoredUrlCharacters, '');

  return (
    unsafeUrl.test(url) ||
    (/^data:/i.test(url) &&
      !imageUrlAttributes.has(lowerName) &&
      element.localName.toLowerCase() !== 'image')
  );
}

/** Book HTML as a cleaned element of an inert document. */
export function parseBookHtml(html: string) {
  const element = createInertDocument().createElement('div');

  element.innerHTML = html;
  sanitizeBookElement(element);

  return element;
}
