/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * How a book's 1-10 level (`levelOf`, difficulty-core.ts) is shown: its book tier (Slime … Demon
 * King, one per whole step) and five groups of two steps for the library's filters and colours.
 * Not part of upstream.
 */

import { difficultyScale } from '$lib/data/difficulty/difficulty-core';
import type { MessageKey } from '$lib/i18n/en';

/** The book tier of a level's whole step */
export const levelTier = (level: number) =>
  difficultyScale.tiers[Math.min(Math.max(Math.floor(level), 1), 10) - 1];

/** The level's group of two steps, 0 (1-2) to 4 (9-10) */
export const levelGroup = (level: number) => Math.min(Math.max(Math.floor((level - 1) / 2), 0), 4);

/** Message key of a group's name ("Levels 1–2"), for `$t$`. */
export const levelGroupKey = (group: number) => `difficulty.levels${group + 1}` as MessageKey;

/** Theme colour of the level's group (difficulty1-5). */
export const levelColor = (level: number) => `var(--difficulty-${levelGroup(level) + 1})`;
