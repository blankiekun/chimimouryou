/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Difficulty bands as shown on jiten.moe (score 0-5). Not part of upstream.
 */

import type { MessageKey } from '$lib/i18n/en';

/** The bands, lowest first, as message keys `difficulty.<band>` (name) and `…Hint` (meaning). */
const bands = ['beginner', 'easy', 'average', 'hard', 'expert', 'insane'] as const;

export function difficultyBand(difficulty: number) {
  return Math.min(Math.max(Math.floor(difficulty), 0), bands.length - 1);
}

/** Message key of the band's name, for `$t$`. */
export function difficultyNameKey(difficulty: number): MessageKey {
  return `difficulty.${bands[difficultyBand(difficulty)]}`;
}

/** Message key of what the band means for a learner, one line, for `$t$`. */
export function difficultyDescriptionKey(difficulty: number): MessageKey {
  return `difficulty.${bands[difficultyBand(difficulty)]}Hint`;
}

/** Theme colour of the band (difficulty1-5; Insane shares Expert's). */
export function difficultyColor(difficulty: number) {
  return `var(--difficulty-${Math.min(difficultyBand(difficulty) + 1, 5)})`;
}
