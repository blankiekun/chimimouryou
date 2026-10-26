/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Notices a working Yomitan in this browser (its popup appeared on the page), so the standalone
 * first run's install hint goes away. Remembered per browser. Also tells the audiobook players
 * when a word is being looked up (`watchLookups`). Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';

export const yomitanSeen$ = writableBooleanLocalStorageSubject()('yomitanSeen', false);

const popupSelector = '.yomitan-popup,.yomitan-float,.yomichan-popup,.yomichan-float';

/** Yomitan's popup frame, or the host it wraps it in (closed shadow root, `all: initial !important`). */
export function isYomitanPopup(node: Node) {
  if (!(node instanceof Element)) return false;
  if (node.matches(popupSelector)) return true;
  const style = (node as HTMLElement).style;
  return (
    node.tagName === 'DIV' &&
    !!style &&
    style.getPropertyValue('all') === 'initial' &&
    style.getPropertyPriority('all') === 'important'
  );
}

/** Watches the page body for Yomitan's popup until it is seen once. */
export function watchYomitan(window: Window & typeof globalThis) {
  if (yomitanSeen$.getValue() || !window.document.body) return;
  const observer = new window.MutationObserver((records) => {
    if (records.some((record) => Array.from(record.addedNodes).some(isYomitanPopup))) {
      yomitanSeen$.next(true);
      observer.disconnect();
    }
  });
  observer.observe(window.document.body, { childList: true });
}

/** The built-in lookup popup is showing (set by `lookup-popup.svelte`). */
export const builtInPopupOpen$ = new BehaviorSubject(false);

/** Text selected in the book: Yomitan selects the word it looks up, also from its shadow root. */
function bookTextSelected(document: Document) {
  const selection = document.getSelection();
  const node = selection && !selection.isCollapsed ? selection.anchorNode : null;

  return !!node?.parentElement?.closest('.book-content');
}

/**
 * Calls `onChange` when a word starts or stops being looked up: the built-in popup, Yomitan's
 * popup frame (when not in a shadow root) or a selection in the book. Returns the cleanup.
 */
export function watchLookups(document: Document, onChange: (lookingUp: boolean) => void) {
  const frames = () => Array.from(document.querySelectorAll<HTMLElement>(popupSelector));
  let last = false;
  const check = () => {
    const now =
      builtInPopupOpen$.getValue() ||
      frames().some((frame) => frame.style.visibility !== 'hidden') ||
      bookTextSelected(document);

    if (now !== last) {
      last = now;
      onChange(now);
    }
  };
  // Yomitan shows and hides its frame with its style attribute.
  const frameObserver = new MutationObserver(check);
  const watchFrames = () => {
    frameObserver.disconnect();
    frames().forEach((frame) =>
      frameObserver.observe(frame, { attributes: true, attributeFilter: ['style'] })
    );
    check();
  };
  const bodyObserver = new MutationObserver(watchFrames);
  const subscription = builtInPopupOpen$.subscribe(check);

  bodyObserver.observe(document.body, { childList: true });
  watchFrames();
  document.addEventListener('selectionchange', check);

  return () => {
    subscription.unsubscribe();
    bodyObserver.disconnect();
    frameObserver.disconnect();
    document.removeEventListener('selectionchange', check);
  };
}
