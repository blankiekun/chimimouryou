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

import type { DictionarySummary } from './dictionary-importer';

export class DictionaryDatabase {
  prepare(): Promise<void>;
  close(): Promise<void>;
  isPrepared(): boolean;
  bulkAdd(objectStoreName: string, items: unknown[], start: number, count: number): Promise<void>;
  purge(): Promise<boolean>;
  deleteDictionary(
    dictionaryName: string,
    progressRate: number,
    onProgress: (progress: {
      processed: number;
      count: number;
      storeCount: number;
      storesProcesed: number;
    }) => void
  ): Promise<void>;
  getDictionaryInfo(): Promise<DictionarySummary[]>;
  dictionaryExists(title: string): Promise<boolean>;
  getMedia(items: { path: string; dictionary: string }[]): Promise<
    { index: number; dictionary: string; path: string; mediaType: string; content: ArrayBuffer }[]
  >;
}
