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

// chimimouryou: declarations for the TypeScript side, from Yomitan's types/ext/dictionary-importer.d.ts.

import type { DictionaryDatabase } from './dictionary-database';

export type ProgressData = { index: number; count: number; nextStep?: boolean };

export type SummaryItemCount = { total: number };
export type SummaryMetaCount = { total: number; [key: string]: number };

export type DictionarySummary = {
  title: string;
  revision: string;
  sequenced: boolean;
  minimumYomitanVersion?: string;
  version: number;
  importDate: number;
  prefixWildcardsSupported: boolean;
  counts?: {
    terms: SummaryItemCount;
    termMeta: SummaryMetaCount;
    kanji: SummaryItemCount;
    kanjiMeta: SummaryMetaCount;
    tagMeta: SummaryItemCount;
    media: SummaryItemCount;
  };
  styles: string;
  isUpdatable?: boolean;
  indexUrl?: string;
  downloadUrl?: string;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  frequencyMode?: 'occurrence-based' | 'rank-based';
  importSuccess?: boolean;
};

export type MediaLoader = {
  getImageDetails(
    content: ArrayBuffer,
    mediaType: string
  ): Promise<{ content: ArrayBuffer; width: number; height: number }>;
};

export class DictionaryImporter {
  constructor(mediaLoader: MediaLoader, onProgress?: (data: ProgressData) => void);
  importDictionary(
    dictionaryDatabase: DictionaryDatabase,
    archiveContent: ArrayBuffer,
    details: { prefixWildcardsSupported: boolean; yomitanVersion: string }
  ): Promise<{ result: DictionarySummary | null; errors: Error[] }>;
}
