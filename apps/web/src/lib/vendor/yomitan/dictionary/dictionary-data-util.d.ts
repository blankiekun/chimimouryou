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

import type { Pronunciation, Tag, TermDictionaryEntry, TermHeadword } from '../types/dictionary';
import type { DictionarySummary } from './dictionary-importer';

export type TagGroup = { tag: Tag; headwordIndices: number[] };
export type FrequencyData = { frequency: number; displayValue: string | null };
export type TermFrequency = { term: string; reading: string | null; values: FrequencyData[] };
export type DictionaryFrequency<T> = {
  dictionary: string;
  dictionaryAlias: string;
  frequencies: T[];
  freqCount: number;
};
export type GroupedPronunciation = {
  pronunciation: Pronunciation;
  terms: string[];
  reading: string;
  exclusiveTerms: string[];
  exclusiveReadings: string[];
};
export type DictionaryGroupedPronunciations = {
  dictionary: string;
  dictionaryAlias: string;
  pronunciations: GroupedPronunciation[];
};
export type TermFrequencyType = 'popular' | 'rare' | 'normal';

export function groupTermTags(dictionaryEntry: TermDictionaryEntry): TagGroup[];
export function groupTermFrequencies(
  dictionaryEntry: TermDictionaryEntry,
  dictionaryInfo: DictionarySummary[]
): DictionaryFrequency<TermFrequency>[];
export function getGroupedPronunciations(
  dictionaryEntry: TermDictionaryEntry
): DictionaryGroupedPronunciations[];
export function getTermFrequency(termTags: Tag[]): TermFrequencyType;
export function getDisambiguations(
  headwords: TermHeadword[],
  headwordIndices: number[],
  allTermsSet: Set<string>,
  allReadingsSet: Set<string>
): string[];
export function isNonNounVerbOrAdjective(wordClasses: string[]): boolean;
