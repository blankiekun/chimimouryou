/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * What both audiobook players share (audiobook-player.svelte, audiobookshelf-player.svelte): speed
 * per book, line navigation, looping a line, pausing after each line or during a lookup, the sleep
 * timer, keys and the lock screen / headset buttons (Media Session). The players own the audio and
 * hand it over as a `PlaybackMedia`. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { getAudiobookRate, saveAudiobookRate } from '$lib/data/audio/audiobook';
import { audiobookControls, setAudiobookControl } from '$lib/data/audio/audiobook-controls';
import { skipKeyDownListener$ } from '$lib/data/store';
import { watchLookups } from '$lib/data/dictionary/yomitan';
import {
  clampRate,
  cueEndCrossed,
  cueTarget,
  pauseLength,
  repeatLine,
  stepRate
} from '$lib/functions/audiobook/playback';
import type { SubtitleCue } from '$lib/functions/audiobook/subtitles';
import type { MessageKey } from '$lib/i18n';

export interface PlaybackMedia {
  /** Seconds into the whole audiobook, undefined before it loads */
  time(): number | undefined;
  /** Length of the whole audiobook in seconds (0 when unknown) */
  duration(): number;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  paused(): boolean;
  /** Sets the speed (playbackRate and defaultPlaybackRate), keeping the pitch */
  setRate(rate: number): void;
}

export interface PlaybackState {
  rate: number;
  /** Repeat each line */
  loop: boolean;
  /** When the sleep timer pauses (ms since epoch), 0 = off */
  sleepAt: number;
  /** The players' speed or options panel */
  panel: '' | 'speed' | 'options';
}

type Action =
  | 'toggle'
  | 'previous'
  | 'replay'
  | 'next'
  | 'back'
  | 'forward'
  | 'slower'
  | 'faster'
  | 'loop'
  | 'autoPause';

/** Keys (KeyboardEvent.code, "Shift+" when held) while an audiobook is open in Listen. */
export const playbackKeys: { keys: string; code: string; action: Action; label: MessageKey }[] = [
  { keys: 'K', code: 'KeyK', action: 'toggle', label: 'reader.abKeyPlay' },
  { keys: 'J', code: 'KeyJ', action: 'previous', label: 'reader.prevLine' },
  { keys: 'H', code: 'KeyH', action: 'replay', label: 'reader.abReplayLine' },
  { keys: 'L', code: 'KeyL', action: 'next', label: 'reader.nextLine' },
  { keys: 'Shift + J', code: 'Shift+KeyJ', action: 'back', label: 'reader.abKeyBack' },
  { keys: 'Shift + L', code: 'Shift+KeyL', action: 'forward', label: 'reader.abKeyForward' },
  { keys: '[', code: 'BracketLeft', action: 'slower', label: 'reader.abSlower' },
  { keys: ']', code: 'BracketRight', action: 'faster', label: 'reader.abFaster' },
  { keys: 'O', code: 'KeyO', action: 'loop', label: 'reader.abLoop' },
  { keys: 'I', code: 'KeyI', action: 'autoPause', label: 'reader.abAutoPause' }
];

/** Wait before going on after a lookup, so moving to the next word doesn't restart the audio. */
const lookupResumeDelay = 400;

export class PlaybackController {
  readonly state$: BehaviorSubject<PlaybackState>;
  private cues: SubtitleCue[] = [];

  private last: number | undefined;
  private repeatIndex = -1;
  private repeats = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private lookupTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private pausedForLookup = false;
  private lookingUp = false;

  constructor(
    private media: PlaybackMedia,
    private title: string
  ) {
    this.state$ = new BehaviorSubject<PlaybackState>({
      rate: clampRate(getAudiobookRate(title)),
      loop: false,
      sleepAt: 0,
      panel: ''
    });
  }

  /** The subtitle lines, in time order */
  setCues(cues: SubtitleCue[]) {
    this.cues = cues;
  }

  /** Sets the book's speed on newly loaded audio. */
  applyRate() {
    this.media.setRate(this.rate);
  }

  get rate() {
    return this.state$.getValue().rate;
  }

  togglePanel(panel: PlaybackState['panel']) {
    this.update({ panel: this.state$.getValue().panel === panel ? '' : panel });
  }

  private update(change: Partial<PlaybackState>) {
    this.state$.next({ ...this.state$.getValue(), ...change });
  }

  /** Keys, lock screen buttons and lookups. Returns the cleanup. */
  start(window: Window & typeof globalThis = globalThis.window) {
    const onKey = (event: KeyboardEvent) => {
      if (this.key(event)) event.preventDefault();
    };
    const stopLookups = watchLookups(window.document, (lookingUp) => this.onLookup(lookingUp));
    const session = 'mediaSession' in window.navigator ? window.navigator.mediaSession : undefined;
    const seekStep = () => audiobookControls().seekSeconds;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.media.play()],
      ['pause', () => this.media.pause()],
      ['previoustrack', () => this.line(-1)],
      ['nexttrack', () => this.line(1)],
      ['seekbackward', (details) => this.seekBy(-(details.seekOffset || seekStep()))],
      ['seekforward', (details) => this.seekBy(details.seekOffset || seekStep())],
      ['seekto', (details) => details.seekTime !== undefined && this.seek(details.seekTime)]
    ];

    window.addEventListener('keydown', onKey);
    if (session) {
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({ title: this.title });
      }
      handlers.forEach(([action, handler]) => {
        try {
          session.setActionHandler(action, handler);
        } catch (_) {
          // An action this browser doesn't know
        }
      });
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      stopLookups();
      cancelAnimationFrame(this.frame);
      [this.resumeTimer, this.sleepTimer, this.lookupTimer].forEach((timer) => clearTimeout(timer));
      handlers.forEach(([action]) => {
        try {
          session?.setActionHandler(action, null);
        } catch (_) {
          // As above
        }
      });
    };
  }

  /** Handles a playback key; true when it was one. */
  key(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      skipKeyDownListener$.getValue() ||
      (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || !!event.target.closest('input, textarea, select')))
    ) {
      return false;
    }

    const code = `${event.shiftKey ? 'Shift+' : ''}${event.code}`;
    const action = playbackKeys.find((key) => key.code === code)?.action;

    if (!action) return false;
    this.run(action);
    return true;
  }

  run(action: Action) {
    switch (action) {
      case 'toggle':
        return this.toggle();
      case 'previous':
        return this.line(-1);
      case 'replay':
        return this.line(0);
      case 'next':
        return this.line(1);
      case 'back':
        return this.seekBy(-audiobookControls().seekSeconds);
      case 'forward':
        return this.seekBy(audiobookControls().seekSeconds);
      case 'slower':
        return this.setRate(stepRate(this.rate, -1));
      case 'faster':
        return this.setRate(stepRate(this.rate, 1));
      case 'loop':
        return this.toggleLoop();
      case 'autoPause':
        return setAudiobookControl('autoPause', !audiobookControls().autoPause);
    }
  }

  toggle() {
    this.clearResume();
    if (this.media.paused()) {
      this.media.play();
    } else {
      this.media.pause();
    }
  }

  seek(seconds: number) {
    const duration = this.media.duration();

    this.clearResume();
    this.last = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    this.media.seek(this.last);
    this.updatePosition();
  }

  seekBy(seconds: number) {
    this.seek((this.media.time() ?? 0) + seconds);
  }

  /** Goes to the previous line (-1), the start of this one (0) or the next (1). */
  line(offset: number) {
    const index = cueTarget(this.cues, this.media.time() ?? 0, offset);

    if (index < 0) {
      this.seekBy((offset > 0 ? 1 : -1) * audiobookControls().seekSeconds);
    } else {
      this.repeatIndex = index;
      this.repeats = 0;
      this.seek(this.cues[index].startSeconds);
    }
  }

  setRate(rate: number) {
    const value = clampRate(rate);

    this.update({ rate: value });
    this.media.setRate(value);
    saveAudiobookRate(this.title, value);
    this.updatePosition();
  }

  toggleLoop() {
    this.repeats = 0;
    this.update({ loop: !this.state$.getValue().loop });
  }

  /** Pauses in `minutes` (0 = off). */
  setSleep(minutes: number) {
    clearTimeout(this.sleepTimer);
    if (minutes > 0) {
      this.sleepTimer = setTimeout(() => {
        this.media.pause();
        this.update({ sleepAt: 0 });
      }, minutes * 60_000);
    }
    this.update({ sleepAt: minutes > 0 ? Date.now() + minutes * 60_000 : 0 });
  }

  /** The player's play/pause events. */
  playing(isPlaying: boolean) {
    cancelAnimationFrame(this.frame);
    if (isPlaying) {
      this.clearResume();
      this.pausedForLookup = false;
      // timeupdate comes about 4 times a second: too late to stop at the end of a line.
      const loop = () => {
        this.tick();
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    }
    this.updatePosition();
  }

  /** Playback moved on (timeupdate, and every frame while playing): repeats and pauses lines. */
  tick() {
    const time = this.media.time();
    const from = this.last;

    if (time === undefined) return;
    this.last = time;
    if (from === undefined || this.media.paused()) return;

    const index = cueEndCrossed(this.cues, from, time);

    if (index < 0) return;

    const { loopCount, autoPause, autoPauseGap } = audiobookControls();

    if (index !== this.repeatIndex) {
      this.repeatIndex = index;
      this.repeats = 0;
    }
    if (this.state$.getValue().loop && repeatLine(loopCount, this.repeats)) {
      this.repeats += 1;
      this.last = this.cues[index].startSeconds;
      this.media.seek(this.last);
    }
    if (autoPause) {
      this.media.pause();

      const wait = pauseLength(autoPauseGap, this.cues[index], this.rate);

      if (wait > 0) {
        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = undefined;
          this.media.play();
        }, wait * 1000);
      }
    }
  }

  private onLookup(lookingUp: boolean) {
    this.lookingUp = lookingUp;
    clearTimeout(this.lookupTimer);

    if (lookingUp) {
      const waiting = this.resumeTimer !== undefined && this.media.paused();

      if (!audiobookControls().pauseOnLookup || (this.media.paused() && !waiting)) return;
      // Also holds an auto-pause's wait until the lookup ends.
      this.clearResume();
      this.pausedForLookup = true;
      this.media.pause();
    } else if (this.pausedForLookup) {
      this.lookupTimer = setTimeout(() => {
        if (!this.lookingUp && this.pausedForLookup) {
          this.pausedForLookup = false;
          this.media.play();
        }
      }, lookupResumeDelay);
    }
  }

  private clearResume() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
  }

  private updatePosition() {
    const duration = this.media.duration();
    const position = this.media.time();

    if (!('mediaSession' in navigator) || !duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState?.({
        duration,
        position: Math.min(position ?? 0, duration),
        playbackRate: this.rate
      });
    } catch (_) {
      // Not supported, or the audio isn't ready
    }
  }
}
