/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Finding the text under a point for the built-in dictionary's popup, with Yomitan's own scanner
 * (lib/vendor/yomitan/dom): the caret at the point, checked to be on a character, then the
 * scanning length's worth of text from there (ruby readings skipped, layout-aware newlines).
 * `ScanInput` is the input half of Yomitan's TextScanner (language/text-scanner.js): which
 * pointer, touch, pen, mouse button and key events start a scan. Only deep content scanning
 * touches the DOM, and only for the moment of the scan. Not part of upstream.
 */

import { DOMTextScanner } from '$lib/vendor/yomitan/dom/dom-text-scanner';
import {
  anyNodeMatchesSelector,
  getActiveModifiers,
  getNodesInRange,
  isPointInSelection
} from '$lib/vendor/yomitan/dom/document-util';
import { extractSentence, getRangeFromPoint } from '$lib/vendor/yomitan/dom/text-source-generator';
import type {
  ScanningInput,
  ScanningOptions,
  SentenceParsingOptions
} from '$lib/vendor/yomitan/types/settings';

export interface ScannedText {
  /** Where the text starts (a ruby's start when the point is on ruby) */
  node: Node;
  offset: number;
  text: string;
  /** A selection looked up as it is (scanSelectedText): the match is this range, never expanded */
  fixed?: Range;
}

type ScanSettings = Pick<
  ScanningOptions,
  'length' | 'layoutAwareScan' | 'normalizeCssZoom' | 'deepDomScan' | 'scanResolution'
>;

export function scanAt(
  x: number,
  y: number,
  scanning: ScanSettings,
  doc: Document = document,
  exclude = ''
): ScannedText | null {
  const range = getRangeFromPoint(x, y, scanning.normalizeCssZoom, doc, scanning.deepDomScan);
  if (!range) return null;
  let { startContainer: node, startOffset: offset } = range;
  const layoutAware = scanning.layoutAwareScan;
  if (scanning.scanResolution === 'word') {
    // As TextScanner._search: the start moves back to the word's start (TextSourceRange.setStartOffset).
    const back = new DOMTextScanner(node, offset, !layoutAware, layoutAware, true).seek(
      -scanning.length
    );
    ({ node, offset } = back);
  }
  // As TextSourceRange.setEndOffset: from the start, `length` code points.
  let length = scanning.length;
  let { content } = new DOMTextScanner(node, offset, !layoutAware, layoutAware).seek(length);
  if (exclude) {
    // TextScanner._constrainTextSource: shortened until no excluded element is in it.
    length = [...content].length;
    while (
      length > 0 &&
      anyNodeMatchesSelector(
        getNodesInRange(scannedRange({ node, offset, text: content }, length, layoutAware)),
        exclude
      )
    ) {
      length -= 1;
      content = new DOMTextScanner(node, offset, !layoutAware, layoutAware).seek(length).content;
    }
    if (length === 0) return null;
  }
  return content.trim() ? { node, offset, text: content } : null;
}

/** The selection's first range as a scan (Frontend._scanSelectedText), or null when empty. */
export function scanSelection(selection: Selection | null): ScannedText | null {
  if (!selection) return null;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    const text = range.toString();
    if (text.length > 0) {
      return {
        node: range.startContainer,
        offset: range.startOffset,
        text,
        fixed: range.cloneRange()
      };
    }
  }
  return null;
}

/** The range of the first `length` characters of a scan, as Yomitan selects a match. */
export function scannedRange(scan: ScannedText, length: number, layoutAware: boolean) {
  if (scan.fixed) return scan.fixed.cloneRange();
  const end = new DOMTextScanner(scan.node, scan.offset, !layoutAware, layoutAware).seek(length);
  const range = (scan.node.ownerDocument ?? document).createRange();
  // On a reading the scanner starts at its ruby (DOMTextScanner.getParentRubyElement).
  const rt = scan.node.parentElement?.closest('rt');
  if (rt?.parentElement?.nodeName === 'RUBY') range.setStartBefore(rt.parentElement);
  else range.setStart(scan.node, scan.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * The sentence around a match of `length` characters, for Anki's {sentence}: Yomitan's sentence
 * parsing options turned into its maps (TextScanner.setOptions), then its extractSentence.
 */
export function scannedSentence(
  scan: ScannedText,
  length: number,
  layoutAware: boolean,
  { scanExtent, terminationCharacterMode, terminationCharacters }: SentenceParsingOptions
) {
  const terminators = new Map<string, [boolean, boolean]>();
  const forwardQuotes = new Map<string, [string, boolean]>();
  const backwardQuotes = new Map<string, [string, boolean]>();
  if (terminationCharacterMode === 'custom' || terminationCharacterMode === 'custom-no-newlines') {
    for (const { enabled, character1, character2, ...include } of terminationCharacters) {
      if (!enabled) continue;
      if (character2 === null) {
        terminators.set(character1, [
          include.includeCharacterAtStart,
          include.includeCharacterAtEnd
        ]);
      } else {
        forwardQuotes.set(character1, [character2, include.includeCharacterAtStart]);
        backwardQuotes.set(character2, [character1, include.includeCharacterAtEnd]);
      }
    }
  }
  return extractSentence(
    scan.node,
    scan.offset,
    length,
    layoutAware,
    scanExtent,
    terminationCharacterMode === 'custom' || terminationCharacterMode === 'newlines',
    terminators,
    forwardQuotes,
    backwardQuotes
  );
}

const inputArray = (value: string) =>
  value
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

/**
 * The scanning input that applies to a pointer with these modifiers and buttons
 * (TextScanner._getMatchingInputGroup): an input whose modifiers are all held wins over one that
 * needs none.
 */
export function matchingInput(
  inputs: ScanningInput[],
  pointerType: 'mouse' | 'touch' | 'pen',
  modifiers: string[]
) {
  const held = new Set(modifiers);
  const hasAll = (values: string[]) => values.every((value) => held.has(value));
  let fallback: ScanningInput | undefined;
  for (const input of inputs) {
    if (!input.types[pointerType]) continue;
    const include = inputArray(input.include);
    const exclude = inputArray(input.exclude);
    if (hasAll(include) && (exclude.length === 0 || !hasAll(exclude))) {
      if (include.length) return input;
      fallback ??= input;
    }
  }
  return fallback;
}

/**
 * The keys (KeyboardEvent.key) the mouse scanning inputs hold, for the VN player's key gate
 * (static/vn/vnbox.js scanKeys). Ctrl is left out: it stays the game's Skip.
 */
export function scanModifierKeys(inputs: ScanningInput[]) {
  const keys: Record<string, string> = { shift: 'Shift', alt: 'Alt', meta: 'Meta' };
  const held = inputs
    .filter((input) => input.types.mouse)
    .flatMap((input) => inputArray(input.include));
  return [...new Set(held.map((name) => keys[name]).filter(Boolean))];
}

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** What started a scan (TextScanner's InputInfo). */
export interface ScanInputInfo {
  input: ScanningInput;
  pointerType: PointerKind;
  /** No modifier is required: the hover waits for the scanning delay */
  passive: boolean;
}

export interface ScanInputHost {
  /** The current scanning options; undefined while lookups are off */
  options(): ScanningOptions | undefined;
  /**
   * Looks up the text at a viewport point: undefined (right away) when there is no text there,
   * else a promise that settles once the popup shows the result or nothing was found.
   */
  search(x: number, y: number, info: ScanInputInfo): Promise<void> | undefined;
  /** A key for where the match on show starts (TextSource.hasSameStart), or null when none */
  current(): string | null;
  /** A primary mouse press (TextScanner's 'clear' on mousedown) */
  clear(): void;
  /** The target is in the popup (Yomitan's popup pages) rather than the reader (web pages) */
  inPopup(target: EventTarget | null): boolean;
}

/** Modifier keys and held mouse buttons (getActiveModifiersAndButtons, also for a frame's events). */
export function modifiersAndButtons(event: MouseEvent | KeyboardEvent | TouchEvent) {
  const modifiers = getActiveModifiers(event);
  const buttons = (event as MouseEvent).buttons;
  if (typeof buttons === 'number') {
    for (let i = 0; i < 6; i++) if (buttons & (1 << i)) modifiers.push(`mouse${i}`);
  }
  return modifiers;
}

/**
 * The input half of Yomitan's TextScanner: pointer, touch, pen, mouse button and key events in,
 * scans out (`host.search`). Feed it every event type in `scanEventTypes`, captured, from the
 * window and from any attached frame (with the frame's offset). `claimed` is true while the
 * current touch or pen gesture was taken by a scan, so hosts leave it alone (no page turn,
 * swipe or long press).
 */
export class ScanInput {
  claimed = false;
  private pendingLookup = false;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private scanTimerResolve: ((value: boolean) => void) | undefined;
  private lastMouseMove: { x: number; y: number; buttons: number } | undefined;
  private isMouseOverText = false;
  private touchTapValid = false;
  private touchPressTime = 0;
  private tap: { x: number; y: number } | undefined;
  private preventNextContextMenu = false;
  private preventNextMouseDown = false;
  private preventNextClick = false;
  private preventScroll = false;
  /** 0 out, 1 hovering, 2 pressed, 3 released (input.d.ts PenPointerState) */
  private penPointerState = 0;
  private pointerIdTypeMap = new Map<number, string>();

  constructor(private host: ScanInputHost) {}

  /** Event types to feed `handle` with (`touchmove` must be a non-passive listener). */
  static readonly eventTypes = [
    'pointerover',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'pointerout',
    'mousedown',
    'mouseup',
    'auxclick',
    'contextmenu',
    'click',
    'touchmove',
    'keydown'
  ] as const;

  /** An event at viewport offset (left, top): an attached frame's position, else 0. */
  handle(event: Event, left = 0, top = 0) {
    const options = this.host.options();
    if (!options) return;
    const e = event as PointerEvent;
    const x = e.clientX + left;
    const y = e.clientY + top;
    switch (event.type) {
      case 'pointerover':
        if (e.pointerType === 'pen') this.pointerIdTypeMap.set(e.pointerId, 'pen');
        if (e.isPrimary && e.pointerType === 'pen') {
          this.penPointerState = 1;
          void this.searchAtFromPen(e, x, y, 'pointerOver', false);
        }
        return;
      case 'pointerdown':
        if (!e.isPrimary) return;
        switch (this.pointerType(e)) {
          case 'mouse':
            return this.onMouseDown(e, x, y, options);
          case 'touch':
            return this.onPrimaryTouchStart(e, x, y);
          case 'pen':
            this.penPointerState = 2;
            this.claimed = false;
            void this.searchAtFromPen(e, x, y, 'pointerDown', true);
            return;
        }
        return;
      case 'pointermove':
        if (!e.isPrimary) return;
        switch (this.pointerType(e)) {
          case 'mouse':
            return this.onMouseMove(x, y, e.buttons, modifiersAndButtons(e));
          case 'touch':
            if (!this.preventScroll || !e.cancelable) return;
            this.touchTapValid = false;
            void this.searchIf(
              x,
              y,
              'touch',
              modifiersAndButtons(e),
              (input) => input.options.scanOnTouchMove
            );
            return;
          case 'pen':
            if (this.penPointerState === 2 && (!this.preventScroll || !e.cancelable)) return;
            void this.searchAtFromPen(e, x, y, 'pointerMove', true);
            return;
        }
        return;
      case 'pointerup':
        if (!e.isPrimary) return;
        switch (this.pointerType(e)) {
          case 'touch':
            return this.onPrimaryTouchEnd(e, x, y, true);
          case 'pen':
            this.penPointerState = 3;
            this.preventScroll = false;
            void this.searchAtFromPen(e, x, y, 'pointerUp', false);
            return;
        }
        return;
      case 'pointercancel':
      case 'pointerout':
        this.pointerIdTypeMap.delete(e.pointerId);
        if (!e.isPrimary) return;
        if (e.pointerType === 'mouse') {
          this.scanTimerClear();
          this.lastMouseMove = undefined;
        } else if (e.pointerType === 'touch') {
          if (event.type === 'pointercancel') this.onPrimaryTouchEnd(e, 0, 0, false);
        } else if (e.pointerType === 'pen') {
          this.penPointerState = 0;
          this.preventScroll = false;
          this.preventNextContextMenu = false;
          this.preventNextMouseDown = false;
          this.preventNextClick = false;
        }
        return;
      case 'mousedown':
        // Compatibility mouse events after a touch or pen scan.
        if (this.preventNextMouseDown) {
          this.preventNextMouseDown = false;
          this.preventNextClick = true;
          event.preventDefault();
          event.stopPropagation();
        } else if (e.button === 1 && this.prevents(options.preventMiddleMouse, e.target)) {
          // No autoscroll while the middle button scans.
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      case 'mouseup':
        if (
          (e.button === 3 || e.button === 4) &&
          this.prevents(options.preventBackForward, e.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      case 'auxclick':
        this.preventNextContextMenu = false;
        if (e.button === 1 && this.prevents(options.preventMiddleMouse, e.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      case 'contextmenu':
        if (this.preventNextContextMenu) {
          this.preventNextContextMenu = false;
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      case 'click':
        if (this.preventNextClick) {
          this.preventNextClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (e.pointerType === 'mouse' || !e.pointerType) {
          this.onMouseMove(x, y, e.buttons, modifiersAndButtons(e));
        }
        return;
      case 'touchmove':
        this.touchTapValid = false;
        if (!this.preventScroll) return;
        if (event.cancelable) event.preventDefault();
        else this.preventScroll = false;
        return;
      case 'keydown':
        return this.onKeyDown(event as KeyboardEvent, options);
    }
  }

  /**
   * The touch or pen input for a tap the host passes on (scanOnTouchTap, checked at the touch's
   * end as Yomitan does: no move, held at least minimumTouchTime), or undefined.
   */
  tapInput(x: number, y: number): ScanningInput | undefined {
    const options = this.host.options();
    const tap = this.tap;
    // The tap the touch's end saw (a frame's coordinates may round differently).
    if (!options || !tap || Math.hypot(tap.x - x, tap.y - y) > 16) return undefined;
    const input = matchingInput(options.inputs, 'touch', []);
    return input?.options.scanOnTouchTap ? input : undefined;
  }

  private pointerType(e: PointerEvent) {
    // Workaround for Firefox bug not detecting certain 'touch' events as 'pen' events.
    return this.pointerIdTypeMap.get(e.pointerId) ?? e.pointerType;
  }

  private prevents(
    { onWebPages, onPopupPages, onTextHover }: ScanningOptions['preventMiddleMouse'],
    target: EventTarget | null
  ) {
    const onPage = this.host.inPopup(target) ? onPopupPages : onWebPages;
    return onPage || (onTextHover && this.isMouseOverText);
  }

  private onMouseDown(e: PointerEvent, x: number, y: number, options: ScanningOptions) {
    if (this.preventNextMouseDown) {
      this.preventNextMouseDown = false;
      this.preventNextClick = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    this.claimed = false;
    if (e.button === 0) {
      this.scanTimerClear();
      // The popup is the page's own element here, not Yomitan's frame: a click in it keeps it.
      if (!this.host.inPopup(e.target)) this.host.clear();
    } else if (e.button === 1 && this.prevents(options.preventMiddleMouse, e.target)) {
      // No autoscroll while the middle button scans.
      e.preventDefault();
      e.stopPropagation();
    }
    this.onMouseMove(x, y, e.buttons, modifiersAndButtons(e));
  }

  private onMouseMove(x: number, y: number, buttons: number, modifiers: string[]) {
    this.scanTimerClear();
    this.lastMouseMove = { x, y, buttons };
    const options = this.host.options();
    if (!options) return;
    const info = this.inputInfo(options, 'mouse', modifiers);
    if (!info) return;
    void this.searchAtFromMouseMove(x, y, info);
  }

  private onKeyDown(event: KeyboardEvent, options: ScanningOptions) {
    // scanWithoutMousemove: the modifier pressed while the pointer rests on text.
    if (!options.scanWithoutMousemove || !this.lastMouseMove) return;
    const modifiers = getActiveModifiers(event);
    const included = options.inputs.flatMap((input) => inputArray(input.include));
    if (!modifiers.some((modifier) => included.includes(modifier))) return;
    const active =
      (event.target as Node | null)?.ownerDocument?.activeElement ?? document.activeElement;
    if (
      active &&
      (active.nodeName === 'INPUT' ||
        active.nodeName === 'TEXTAREA' ||
        (active as HTMLElement).isContentEditable)
    ) {
      return;
    }
    const { x, y, buttons } = this.lastMouseMove;
    const withButtons = modifiersAndButtons({ ...modifierFlags(modifiers), buttons } as MouseEvent);
    this.onMouseMove(x, y, buttons, withButtons);
  }

  private onPrimaryTouchStart(e: PointerEvent, x: number, y: number) {
    this.preventScroll = false;
    this.preventNextContextMenu = false;
    this.preventNextMouseDown = false;
    this.preventNextClick = false;
    this.claimed = false;
    this.tap = undefined;
    this.touchTapValid = true;
    this.touchPressTime = Date.now();
    const doc = (e.target as Node | null)?.ownerDocument ?? document;
    const selection = doc.getSelection();
    // A press on the selection is the selection's (its handles, the toolbar).
    if (selection && isPointInSelection(e.clientX, e.clientY, selection, 'ja', null)) return;
    if (this.pendingLookup) return;
    void this.searchClaiming(x, y, 'touch', modifiersAndButtons(e), (input) =>
      input.options.scanOnTouchPress
        ? { preventScroll: input.options.preventTouchScrolling, click: false }
        : undefined
    );
  }

  private onPrimaryTouchEnd(e: PointerEvent, x: number, y: number, allowSearch: boolean) {
    const held = Date.now() - this.touchPressTime;
    this.preventScroll = false;
    this.preventNextClick = false;
    if (!allowSearch) return;
    const options = this.host.options();
    const info = options && this.inputInfo(options, 'touch', modifiersAndButtons(e));
    if (!info) return;
    if (held < info.input.options.minimumTouchTime) return;
    // A tap is looked up when the host passes it on (tapAt), so its own tap handling comes first.
    if (this.touchTapValid) this.tap = { x, y };
    if (info.input.options.scanOnTouchRelease) {
      void this.searchClaiming(x, y, 'touch', modifiersAndButtons(e), () => ({
        preventScroll: false,
        click: false,
        released: true
      }));
    }
  }

  private async searchAtFromPen(
    e: PointerEvent,
    x: number,
    y: number,
    eventType: 'pointerOver' | 'pointerDown' | 'pointerMove' | 'pointerUp',
    prevent: boolean
  ) {
    if (this.pendingLookup) return;
    const options = this.host.options();
    const info = options && this.inputInfo(options, 'pen', modifiersAndButtons(e));
    if (!info || !this.isPenEventSupported(eventType, info.input)) return;
    const before = this.host.current();
    if (await this.searchAt(x, y, info, () => (this.claimed = true))) {
      const now = this.host.current();
      if (now === null || now === before) this.claimed = false;
    }
    const now = this.host.current();
    if (prevent && now !== null) {
      this.preventScroll = info.input.options.preventPenScrolling;
      this.preventNextContextMenu = true;
      this.preventNextMouseDown = true;
      this.preventNextClick = true;
    }
  }

  private isPenEventSupported(eventType: string, input: ScanningInput) {
    if (eventType === 'pointerDown') return input.options.scanOnPenPress;
    if (eventType === 'pointerUp') return input.options.scanOnPenRelease;
    switch (this.penPointerState) {
      case 1:
        return input.options.scanOnPenHover;
      case 2:
        return input.options.scanOnPenMove;
      case 3:
        return input.options.scanOnPenReleaseHover;
    }
    return false;
  }

  /** A touch scan (press, release) that takes the gesture when it shows a new match. */
  private async searchClaiming(
    x: number,
    y: number,
    type: PointerKind,
    modifiers: string[],
    when: (
      input: ScanningInput
    ) => { preventScroll: boolean; click: boolean; released?: boolean } | undefined
  ) {
    const options = this.host.options();
    const info = options && this.inputInfo(options, type, modifiers);
    const how = info && when(info.input);
    if (!info || !how) return;
    const before = this.host.current();
    // Taken right away when there is text, so the host's tap or swipe that follows sees it.
    if (!(await this.searchAt(x, y, info, () => (this.claimed = true)))) return;
    const now = this.host.current();
    if (now === null || now === before) {
      this.claimed = false;
      return;
    }
    if (!how.released) {
      this.preventScroll = how.preventScroll;
      this.preventNextContextMenu = true;
    }
    this.preventNextMouseDown = true;
  }

  private async searchIf(
    x: number,
    y: number,
    type: PointerKind,
    modifiers: string[],
    when: (input: ScanningInput) => boolean
  ) {
    const options = this.host.options();
    const info = options && this.inputInfo(options, type, modifiers);
    if (info && when(info.input)) await this.searchAt(x, y, info);
  }

  private async searchAtFromMouseMove(x: number, y: number, info: ScanInputInfo) {
    if (this.pendingLookup) return;
    if (info.passive && !(await this.scanTimerWait())) return;
    await this.searchAt(x, y, info);
  }

  /** True when there was text at the point (`onText` runs right then, before the lookup). */
  private async searchAt(x: number, y: number, info: ScanInputInfo, onText?: () => void) {
    if (this.pendingLookup) return false;
    this.pendingLookup = true;
    this.scanTimerClear();
    try {
      const lookup = this.host.search(x, y, info);
      this.isMouseOverText = !!lookup;
      if (lookup) onText?.();
      await lookup;
      return !!lookup;
    } catch {
      return this.isMouseOverText;
    } finally {
      this.pendingLookup = false;
    }
  }

  private inputInfo(options: ScanningOptions, pointerType: PointerKind, modifiers: string[]) {
    const input = matchingInput(options.inputs, pointerType, modifiers);
    if (!input) return undefined;
    return { input, pointerType, passive: inputArray(input.include).length === 0 };
  }

  private scanTimerWait() {
    const delay = this.host.options()?.delay ?? 0;
    return new Promise<boolean>((resolve) => {
      this.scanTimerResolve = resolve;
      this.scanTimer = setTimeout(() => {
        this.scanTimerResolve = undefined;
        resolve(true);
      }, delay);
    });
  }

  private scanTimerClear() {
    clearTimeout(this.scanTimer);
    this.scanTimerResolve?.(false);
    this.scanTimerResolve = undefined;
  }
}

const modifierFlags = (modifiers: string[]) => ({
  altKey: modifiers.includes('alt'),
  ctrlKey: modifiers.includes('ctrl'),
  metaKey: modifiers.includes('meta'),
  shiftKey: modifiers.includes('shift')
});
