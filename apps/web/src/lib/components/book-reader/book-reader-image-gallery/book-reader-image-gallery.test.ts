/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  imageGallerySpoilerSync,
  readerImageGalleryPictures$,
  toggleImageGalleryPictureSpoiler$
} from './book-reader-image-gallery';

describe('imageGallerySpoilerSync', () => {
  it('applies the collected toggles together after a pause', () => {
    vi.useFakeTimers();

    const { collect$, apply$ } = imageGallerySpoilerSync();
    const subscriptions = [collect$.subscribe(), apply$.subscribe()];

    readerImageGalleryPictures$.next([
      { url: 'a', unspoilered: false },
      { url: 'b', unspoilered: false }
    ]);
    toggleImageGalleryPictureSpoiler$.next({ url: 'a', unspoilered: true });
    vi.advanceTimersByTime(100);
    toggleImageGalleryPictureSpoiler$.next({ url: 'b', unspoilered: true });
    toggleImageGalleryPictureSpoiler$.next({ url: 'b', unspoilered: false });
    expect(readerImageGalleryPictures$.getValue()[0].unspoilered).toBe(false);

    vi.advanceTimersByTime(250);
    expect(readerImageGalleryPictures$.getValue()).toEqual([
      { url: 'a', unspoilered: true },
      { url: 'b', unspoilered: false }
    ]);

    subscriptions.forEach((subscription) => subscription.unsubscribe());
    vi.useRealTimers();
  });
});
