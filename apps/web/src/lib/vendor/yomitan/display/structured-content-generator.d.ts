/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// chimimouryou: declarations for the TypeScript side (Yomitan types these with JSDoc).

import type { Content, ImageElement } from '../types/structured-content';
import type { TermGlossaryImage } from '../types/dictionary-data';

/** What the generator needs from its host: media from the dictionary database, safe links. */
export interface ContentManager {
  loadMedia(
    path: string,
    dictionary: string,
    onLoad: (url: string) => void,
    onUnload: () => void
  ): void;
  prepareLink(element: HTMLAnchorElement, href: string, internal: boolean): void;
}

export class StructuredContentGenerator {
  constructor(contentManager: ContentManager, document: Document, window: Window);
  appendStructuredContent(node: HTMLElement, content: Content, dictionary: string): void;
  createStructuredContent(content: Content, dictionary: string): HTMLElement;
  createDefinitionImage(
    data: ImageElement | TermGlossaryImage,
    dictionary: string
  ): HTMLAnchorElement;
}
