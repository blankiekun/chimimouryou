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

export function getRangeFromPoint(
  x: number,
  y: number,
  normalizeCssZoom: boolean,
  doc?: Document
): Range | null;

export function extractSentence(
  node: Node,
  offset: number,
  length: number,
  layoutAwareScan: boolean,
  extent: number,
  terminateAtNewlines: boolean,
  terminatorMap: Map<string, [boolean, boolean]>,
  forwardQuoteMap: Map<string, [string, boolean]>,
  backwardQuoteMap: Map<string, [string, boolean]>
): { text: string; offset: number };
