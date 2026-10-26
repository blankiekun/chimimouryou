/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface BookCardProps {
  id: number;
  imagePath: string | Blob;
  title: string;
  /** Shown instead of the title (the identity) when details from VNDB name it */
  displayTitle?: string;
  characters: number;
  lastBookModified: number;
  lastBookOpen: number;
  progress: number;
  lastBookmarkModified: number;
  isPlaceholder: boolean;
  authors?: string;
  series?: string;
  seriesIndex?: number | null;
  seriesInferred?: boolean;
  tags?: string[];
  rating?: number | null;
  /** The estimate's 1-10 level (`levelOf` in difficulty-core.ts) */
  difficulty?: number;
  /** Cached share of the book's word occurrences that are known (`known-words.ts`), for sorting */
  coverage?: number;
  /** CBZ/ZIP read in the manga reader */
  manga?: boolean;
  /** ONScripter game played in the visual novel player */
  vn?: boolean;
  /** Calibre book id, for books from the Calibre source */
  calibreId?: number;
}
