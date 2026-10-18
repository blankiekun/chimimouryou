/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Difficulty bands as shown on jiten.moe (score 0-5). Not part of upstream.
 */

export const difficultyNames = ['Beginner', 'Easy', 'Average', 'Hard', 'Expert', 'Insane'] as const;

/** What each band means for a learner, one line each (same order as difficultyNames). */
export const difficultyDescriptions = [
  'Very simple text, almost only the most common words',
  'Simple prose with few rare words or kanji',
  'Everyday fiction with a broader vocabulary',
  'Rich vocabulary and denser sentences',
  'Literary or specialised text with many rare words',
  'The top of the scale: rare words and heavy prose throughout'
] as const;

export function difficultyDescription(difficulty: number) {
  return difficultyDescriptions[difficultyBand(difficulty)];
}

export function difficultyBand(difficulty: number) {
  return Math.min(Math.max(Math.floor(difficulty), 0), difficultyNames.length - 1);
}

export function difficultyName(difficulty: number) {
  return difficultyNames[difficultyBand(difficulty)];
}

/** Theme colour of the band (difficulty1-5; Insane shares Expert's). */
export function difficultyColor(difficulty: number) {
  return `var(--difficulty-${Math.min(difficultyBand(difficulty) + 1, 5)})`;
}
