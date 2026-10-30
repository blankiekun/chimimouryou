/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Svelte actions that draw a glossary item and a pitch accent with Yomitan's own generators
 * (lib/vendor/yomitan/display). The generators only make whitelisted elements and set text and
 * styles through the DOM, never HTML; links here only open http(s) pages in a new tab or, for
 * Yomitan's internal `?query=` links, look the word up. Images come from the dictionary
 * database as blob URLs, revoked when the item goes. Not part of upstream.
 */

import { getDictionaryMedia } from '$lib/data/dictionary/dictionary';
import { PronunciationGenerator } from '$lib/vendor/yomitan/display/pronunciation-generator';
import {
  StructuredContentGenerator,
  type ContentManager
} from '$lib/vendor/yomitan/display/structured-content-generator';
import { getKanaMorae } from '$lib/vendor/yomitan/language/ja/japanese';
import type { TermGlossaryContent } from '$lib/vendor/yomitan/types/dictionary-data';
import type { PitchAccent } from '$lib/vendor/yomitan/types/dictionary';

export interface GlossaryParams {
  entry: TermGlossaryContent;
  dictionary: string;
  /** An internal link (`?query=…`) was followed */
  onLookup: (query: string) => void;
}

/** Yomitan's internal link target: the query of `?query=…&wildcards=off`. */
export function internalQuery(href: string) {
  return new URLSearchParams(href.slice(1)).get('query') ?? '';
}

export function safeExternalUrl(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function render(node: HTMLElement, { entry, dictionary, onLookup }: GlossaryParams) {
  const urls: string[] = [];
  let alive = true;
  const manager: ContentManager = {
    loadMedia(path, dictionaryName, onLoad, onUnload) {
      getDictionaryMedia(path, dictionaryName).then(
        (blob) => {
          if (!alive || !blob) return blob ? undefined : onUnload();
          const url = URL.createObjectURL(blob);
          urls.push(url);
          onLoad(url);
        },
        () => onUnload()
      );
    },
    prepareLink(element, href, internal) {
      if (internal) {
        const query = internalQuery(href);
        element.href = '#';
        element.addEventListener('click', (event) => {
          event.preventDefault();
          if (query) onLookup(query);
        });
        return;
      }
      const url = safeExternalUrl(href);
      if (url) {
        element.href = url;
        element.target = '_blank';
        element.rel = 'noreferrer noopener';
      }
    }
  };
  const generator = new StructuredContentGenerator(manager, document, window);
  node.replaceChildren();
  if (typeof entry === 'string') {
    // DisplayGenerator._setMultilineTextContent: lines with <br>, so copies keep them.
    entry.split('\n').forEach((line, index) => {
      if (index) node.append(document.createElement('br'));
      node.append(line);
    });
  } else if (entry.type === 'text') {
    node.textContent = entry.text;
  } else if (entry.type === 'image') {
    node.append(generator.createDefinitionImage(entry, dictionary));
    if (typeof entry.description === 'string') {
      const description = document.createElement('span');
      description.className = 'gloss-image-description';
      description.textContent = entry.description;
      node.append(description);
    }
  } else if (entry.type === 'structured-content') {
    generator.appendStructuredContent(node, entry.content, dictionary);
  }
  return () => {
    alive = false;
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
}

export function glossary(node: HTMLElement, params: GlossaryParams) {
  let cleanup = render(node, params);
  return {
    update(next: GlossaryParams) {
      cleanup();
      cleanup = render(node, next);
    },
    destroy: () => cleanup()
  };
}

export interface PitchParams {
  pitch: PitchAccent;
  reading: string;
  part: 'text' | 'graph' | 'position';
}

/** DisplayGenerator._createPronunciationPitchAccent's three notations, one per element. */
export function pitchAccent(node: HTMLElement, params: PitchParams) {
  const draw = ({ pitch, reading, part }: PitchParams) => {
    const generator = new PronunciationGenerator(document);
    const morae = getKanaMorae(reading);
    const { positions, nasalPositions, devoicePositions } = pitch;
    node.replaceChildren(
      part === 'text'
        ? generator.createPronunciationText(morae, positions, nasalPositions, devoicePositions)
        : part === 'graph'
          ? generator.createPronunciationGraph(morae, positions)
          : generator.createPronunciationDownstepPosition(positions)
    );
  };
  draw(params);
  return { update: draw };
}
