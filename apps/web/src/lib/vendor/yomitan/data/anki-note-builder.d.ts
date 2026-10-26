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

import type { TermDictionaryEntry } from '../types/dictionary';
import type {
  AnkiCardFormat,
  AnkiDuplicateScope,
  GlossaryLayoutMode,
  ResultOutputMode
} from '../types/settings';

export type AnkiNote = {
  fields: Record<string, string>;
  tags: string[];
  deckName: string;
  modelName: string;
  options: {
    allowDuplicate: boolean;
    duplicateScope: AnkiDuplicateScope;
    duplicateScopeOptions: {
      deckName: string | null;
      checkChildren: boolean;
      checkAllModels: boolean;
    };
  };
};

export type AnkiNoteContext = {
  url: string;
  documentTitle: string;
  query: string;
  fullQuery: string;
  sentence: { text: string; offset: number };
};

export type CreateNoteDetails = {
  dictionaryEntry: TermDictionaryEntry;
  cardFormat: AnkiCardFormat;
  context: AnkiNoteContext;
  template: string;
  tags?: string[];
  duplicateScope?: AnkiDuplicateScope;
  duplicateScopeCheckAllModels?: boolean;
  resultOutputMode?: ResultOutputMode;
  glossaryLayoutMode?: GlossaryLayoutMode;
  compactTags?: boolean;
  dictionaryStylesMap?: Map<string, string>;
};

export class AnkiNoteBuilder {
  constructor(api: unknown, templateRenderer: unknown);
  createNote(
    details: CreateNoteDetails
  ): Promise<{ note: AnkiNote; errors: Error[]; requirements: unknown[] }>;
  getDictionaryStylesMap(dictionaries: { name: string; styles?: string }[]): Map<string, string>;
}
