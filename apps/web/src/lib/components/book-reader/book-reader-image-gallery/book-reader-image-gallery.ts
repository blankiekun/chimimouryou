/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { debounceTime, Subject, tap } from 'rxjs';
import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
import { writableSubject } from '$lib/functions/svelte/store';

export enum ReaderImageGalleryAvailableKeybind {
  PREVIOUS_IMAGE = 'previousImage',
  NEXT_IMAGE = 'nextImage',
  CLOSE = 'close'
}

export interface ReaderImageGalleryPicture {
  url: string;
  unspoilered: boolean;
}

export type ReaderImageGalleryKeybindMap = Record<string, ReaderImageGalleryAvailableKeybind>;

export function setReaderImageGalleryPictureSpoiler() {}

export const readerImageGalleryPictures$ = writableSubject<ReaderImageGalleryPicture[]>([]);

export const toggleImageGalleryPictureSpoiler$ = new Subject<ReaderImageGalleryPicture>();

export const updateImageGalleryPictureSpoilers$ = new Subject<void>();

/**
 * The reader's spoiler toggles from the gallery: collected, then applied to the pictures together
 * 250 ms after the last one. Both streams are subscribed while the reader is open.
 */
export function imageGallerySpoilerSync() {
  const queued = new Map<string, boolean>();

  const collect$ = toggleImageGalleryPictureSpoiler$.pipe(
    tap((picture) => {
      queued.set(picture.url, picture.unspoilered);

      updateImageGalleryPictureSpoilers$.next();
    }),
    reduceToEmptyString()
  );

  const apply$ = updateImageGalleryPictureSpoilers$.pipe(
    debounceTime(250),
    tap(() => {
      readerImageGalleryPictures$.next(
        readerImageGalleryPictures$.getValue().map((galleryPicture) => {
          const picture = galleryPicture;

          if (queued.has(picture.url)) {
            picture.unspoilered = queued.get(picture.url)!;
          }

          return picture;
        })
      );

      queued.clear();
    }),
    reduceToEmptyString()
  );

  return { collect$, apply$ };
}
