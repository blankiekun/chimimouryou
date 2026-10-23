/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Notices a working Yomitan in this browser (its popup appeared on the page), so the standalone
 * first run's install hint goes away. Remembered per browser. Not part of upstream.
 */

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
export function watchYomitan(window: Window) {
  if (yomitanSeen$.getValue() || !window.document.body) return;
  const observer = new window.MutationObserver((records) => {
    if (records.some((record) => Array.from(record.addedNodes).some(isYomitanPopup))) {
      yomitanSeen$.next(true);
      observer.disconnect();
    }
  });
  observer.observe(window.document.body, { childList: true });
}
