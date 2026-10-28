/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Phones: a bottom sheet (the reader panel, the Aa/More sheets) follows a vertical drag and snaps
 * to its usual height, full height or closed. Not part of upstream.
 */

export type SheetSnap = 'half' | 'full' | 'closed';

/** px/ms: a release this fast is a flick */
const flickSpeed = 0.5;
/** Let go below this share of the usual height and the sheet closes */
const closeShare = 0.6;
/** px before a press becomes a drag, so taps on tabs and buttons still work */
const dragStart = 8;

/**
 * Where a sheet let go at `height` settles. `velocity` is px/ms, positive downwards; `half` is its
 * usual height and `full` its tallest.
 */
export function sheetSnap(height: number, velocity: number, half: number, full: number): SheetSnap {
  if (velocity < -flickSpeed) return height >= half && full > half ? 'full' : 'half';
  if (velocity > flickSpeed) return height > half ? 'half' : 'closed';
  if (height < half * closeShare) return 'closed';
  return full > half && height - half > (full - half) / 2 ? 'full' : 'half';
}

export interface SheetDragOptions {
  /** Where the sheet can always be dragged from (grabber, header, tab row) */
  handles: string;
  /** Class the sheet gets at full height; its CSS sets that height (phones only) */
  fullClass: string;
  close(): void;
  /** For a sheet that stays mounted: back to the usual height when it closes */
  open?: boolean;
}

/**
 * Svelte action. From a handle the sheet drags both ways; from anywhere else only downwards and
 * only when nothing under the finger is scrolled, so the body's own scrolling is left alone.
 */
export function sheetDrag(node: HTMLElement, options: SheetDragOptions) {
  const matches = (query: string) => !!window.matchMedia?.(query).matches;
  let full = false;
  let drag:
    | {
        id: number;
        x: number;
        y: number;
        handle: boolean;
        active: boolean;
        start: number;
        half: number;
        full: number;
        height: number;
        lastY: number;
        lastTime: number;
        velocity: number;
      }
    | undefined;

  const setFull = (value: boolean) => {
    full = value;
    node.classList.toggle(options.fullClass, value);
  };
  const clearStyles = () => {
    node.style.height = '';
    node.style.maxHeight = '';
    node.style.transform = '';
    node.style.transition = '';
  };
  /** The sheet's height at rest, usual or full (measured without painting). */
  const measure = (atFull: boolean) => {
    const inline = node.style.cssText;

    clearStyles();
    node.classList.toggle(options.fullClass, atFull);
    const height = node.getBoundingClientRect().height;
    node.classList.toggle(options.fullClass, full);
    node.style.cssText = inline;
    return height;
  };
  /** Shows the sheet `height` tall: taller than usual grows it, shorter slides it down. */
  const show = (height: number, half: number) => {
    node.style.maxHeight = 'none';
    node.style.height = `${Math.max(height, half)}px`;
    node.style.transform = height < half ? `translateY(${half - height}px)` : '';
  };
  const swallowClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  function onPointerDown(event: PointerEvent) {
    if (!matches('(max-width: 767px)') || !event.isPrimary || event.button !== 0) return;

    const target = event.target as Element;
    const handle = !!target.closest(options.handles);

    if (!handle) {
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      for (
        let el: Element | null = target;
        el && el !== node.parentElement;
        el = el.parentElement
      ) {
        if (el.scrollTop > 0) return;
      }
    }
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      handle,
      active: false,
      start: 0,
      half: 0,
      full: 0,
      height: 0,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0
    };
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;

    const dy = event.clientY - drag.y;

    if (!drag.active) {
      if (Math.abs(dy) < dragStart && Math.abs(event.clientX - drag.x) < dragStart) return;
      // Sideways (the tab row) or up from the body (scrolling it): not a drag.
      if (Math.abs(event.clientX - drag.x) > Math.abs(dy) || (!drag.handle && dy < 0)) {
        drag = undefined;
        return;
      }
      drag.active = true;
      drag.start = node.getBoundingClientRect().height;
      drag.half = measure(false);
      drag.full = Math.max(measure(true), drag.half);
      node.style.transition = 'none';
      node.setPointerCapture?.(event.pointerId);
    }

    const elapsed = event.timeStamp - drag.lastTime;

    if (elapsed > 0) {
      drag.velocity = (event.clientY - drag.lastY) / elapsed;
    }
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    drag.height = Math.max(0, Math.min(drag.full, drag.start - dy));
    show(drag.height, drag.half);
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;

    const done = drag;

    drag = undefined;
    if (!done.active) return;

    // A drag that ends on a tab or button isn't a click on it.
    window.addEventListener('click', swallowClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }));

    // A release after a pause isn't a flick.
    const velocity = event.timeStamp - done.lastTime > 100 ? 0 : done.velocity;
    const snap =
      event.type === 'pointercancel'
        ? full
          ? 'full'
          : 'half'
        : sheetSnap(done.height, velocity, done.half, done.full);
    const finish = () => {
      clearStyles();
      setFull(snap === 'full');
      if (snap === 'closed') options.close();
    };

    if (matches('(prefers-reduced-motion: reduce)')) {
      finish();
      return;
    }
    node.style.transition = 'height 0.2s ease-out, transform 0.2s ease-out';
    show(snap === 'closed' ? 0 : snap === 'full' ? done.full : done.half, done.half);
    // transitionend may never come (nothing changed, or the sheet was hidden): a timer instead.
    setTimeout(finish, 220);
  }

  /** Stops the browser from scrolling or refreshing the page under a drag. */
  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];

    if (!drag || !touch || !event.cancelable) return;

    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;

    if (drag.active || (Math.abs(dy) > Math.abs(dx) && (drag.handle || dy > 0))) {
      event.preventDefault();
    }
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);
  node.addEventListener('touchmove', onTouchMove, { passive: false });

  return {
    update(next: SheetDragOptions) {
      options = next;
      if (options.open === false && full) setFull(false);
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      node.removeEventListener('touchmove', onTouchMove);
    }
  };
}
