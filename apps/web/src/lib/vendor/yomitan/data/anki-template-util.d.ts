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

import type { DictionarySummary } from '../dictionary/dictionary-importer';
import type { ProfileOptions } from '../types/settings';

export function getStandardFieldMarkers(type: 'term' | 'kanji', language?: string): string[];
export function getDynamicTemplates(options: ProfileOptions, dictionaryInfo: DictionarySummary[]): string;
export function getDynamicFieldMarkers(
  dictionaries: ProfileOptions['dictionaries'],
  dictionaryInfo: DictionarySummary[]
): string[];
