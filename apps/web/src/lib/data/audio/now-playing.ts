/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';

/**
 * What a Listen player (audiobook, Audiobookshelf, AI voice) has loaded, for the mini player
 * (`mini-player.svelte`) that drives it while Listen isn't shown. The players own the audio and
 * stay mounted in the reader panel. Not part of upstream.
 */
export interface NowPlaying {
  playing: boolean;
  /** The line being read, or what is loaded */
  text: string;
  /** "1:02 / 45:10", empty when there is no clock (AI voice) */
  time: string;
  rate: number;
  /** Speeds the speed button steps through */
  rates: readonly number[];
  toggle(): void;
  /** Previous (-1) or next (1) line */
  step(offset: number): void;
  setRate(rate: number): void;
}

export const nowPlaying$ = new BehaviorSubject<NowPlaying | undefined>(undefined);

/** A player's publisher: pass its state while loaded, undefined when not (and on destroy). */
export function nowPlayingPublisher() {
  let mine: NowPlaying | undefined;

  return (value: NowPlaying | undefined) => {
    if (value) {
      nowPlaying$.next((mine = value));
    } else if (mine) {
      // Another player may have taken over (Listen's source changed): leave it alone.
      if (nowPlaying$.getValue() === mine) nowPlaying$.next(undefined);
      mine = undefined;
    }
  };
}

/** The speed after `rate`, wrapping round to the slowest. */
export const nextRate = (rates: readonly number[], rate: number) =>
  rates.find((item) => item > rate + 0.001) ?? rates[0];
