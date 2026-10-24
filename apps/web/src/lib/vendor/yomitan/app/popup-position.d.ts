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

import type { NormalizedWritingMode } from '../dom/document-util';

export type Rect = { left: number; top: number; right: number; bottom: number };
export type SizeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  after: boolean;
  below: boolean;
};
export type PopupPositionOptions = {
  width: number;
  height: number;
  horizontalOffset: number;
  verticalOffset: number;
  horizontalOffset2: number;
  verticalOffset2: number;
  horizontalTextPositionBelow: boolean;
  verticalTextPosition: string;
};

export function getPosition(
  sourceRects: Rect[],
  writingMode: NormalizedWritingMode,
  viewport: Rect,
  options: PopupPositionOptions
): SizeRect;
