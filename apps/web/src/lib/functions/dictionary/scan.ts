/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Finding the text under a point for the built-in dictionary's popup, with Yomitan's own scanner
 * (lib/vendor/yomitan/dom): the caret at the point, checked to be on a character, then the
 * scanning length's worth of text from there (ruby readings skipped, layout-aware newlines).
 * Never changes the DOM. Not part of upstream.
 */

import { DOMTextScanner } from '$lib/vendor/yomitan/dom/dom-text-scanner';
import { extractSentence, getRangeFromPoint } from '$lib/vendor/yomitan/dom/text-source-generator';
import type {
  ScanningInput,
  ScanningOptions,
  SentenceParsingOptions
} from '$lib/vendor/yomitan/types/settings';

export interface ScannedText {
  /** Where the text starts (a ruby's start when the point is on ruby) */
  node: Node;
  offset: number;
  text: string;
}

export function scanAt(
  x: number,
  y: number,
  scanning: Pick<ScanningOptions, 'length' | 'layoutAwareScan' | 'normalizeCssZoom'>,
  doc: Document = document
): ScannedText | null {
  const range = getRangeFromPoint(x, y, scanning.normalizeCssZoom, doc);
  if (!range) return null;
  const { startContainer: node, startOffset: offset } = range;
  const layoutAware = scanning.layoutAwareScan;
  // As TextSourceRange.setEndOffset: from the start, `length` code points.
  const { content } = new DOMTextScanner(node, offset, !layoutAware, layoutAware).seek(
    scanning.length
  );
  return content.trim() ? { node, offset, text: content } : null;
}

/** The range of the first `length` characters of a scan, as Yomitan selects a match. */
export function scannedRange(scan: ScannedText, length: number, layoutAware: boolean) {
  const end = new DOMTextScanner(scan.node, scan.offset, !layoutAware, layoutAware).seek(length);
  const range = (scan.node.ownerDocument ?? document).createRange();
  // On a reading the scanner starts at its ruby (DOMTextScanner.getParentRubyElement).
  const rt = scan.node.parentElement?.closest('rt');
  if (rt?.parentElement?.nodeName === 'RUBY') range.setStartBefore(rt.parentElement);
  else range.setStart(scan.node, scan.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * The sentence around a match of `length` characters, for Anki's {sentence}: Yomitan's sentence
 * parsing options turned into its maps (TextScanner.setOptions), then its extractSentence.
 */
export function scannedSentence(
  scan: ScannedText,
  length: number,
  layoutAware: boolean,
  { scanExtent, terminationCharacterMode, terminationCharacters }: SentenceParsingOptions
) {
  const terminators = new Map<string, [boolean, boolean]>();
  const forwardQuotes = new Map<string, [string, boolean]>();
  const backwardQuotes = new Map<string, [string, boolean]>();
  if (terminationCharacterMode === 'custom' || terminationCharacterMode === 'custom-no-newlines') {
    for (const { enabled, character1, character2, ...include } of terminationCharacters) {
      if (!enabled) continue;
      if (character2 === null) {
        terminators.set(character1, [
          include.includeCharacterAtStart,
          include.includeCharacterAtEnd
        ]);
      } else {
        forwardQuotes.set(character1, [character2, include.includeCharacterAtStart]);
        backwardQuotes.set(character2, [character1, include.includeCharacterAtEnd]);
      }
    }
  }
  return extractSentence(
    scan.node,
    scan.offset,
    length,
    layoutAware,
    scanExtent,
    terminationCharacterMode === 'custom' || terminationCharacterMode === 'newlines',
    terminators,
    forwardQuotes,
    backwardQuotes
  );
}

const inputArray = (value: string) =>
  value
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

/**
 * The scanning input that applies to a pointer with these modifiers and buttons
 * (TextScanner._getMatchingInputGroup): an input whose modifiers are all held wins over one that
 * needs none.
 */
export function matchingInput(
  inputs: ScanningInput[],
  pointerType: 'mouse' | 'touch' | 'pen',
  modifiers: string[]
) {
  const held = new Set(modifiers);
  const hasAll = (values: string[]) => values.every((value) => held.has(value));
  let fallback: ScanningInput | undefined;
  for (const input of inputs) {
    if (!input.types[pointerType]) continue;
    const include = inputArray(input.include);
    const exclude = inputArray(input.exclude);
    if (hasAll(include) && (exclude.length === 0 || !hasAll(exclude))) {
      if (include.length) return input;
      fallback ??= input;
    }
  }
  return fallback;
}
