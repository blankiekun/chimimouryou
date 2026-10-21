/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  NEVER,
  filter,
  from,
  fromEvent,
  merge,
  race,
  switchMap,
  take,
  takeUntil,
  tap,
  throttleTime,
  timer
} from 'rxjs';

import { FuriganaStyle } from '../../data/furigana-style';
import { loadKnownRubyCheck, markKnownRuby } from '$lib/data/known-furigana';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
import { pulseElement } from '$lib/functions/range-util';
import { toggleImageGalleryPictureSpoiler$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';

export function reactiveElements(
  document: Document,
  furiganaStyle: FuriganaStyle,
  hideSpoilerImage: boolean,
  isExtendedMode: boolean
) {
  const anchorTagDocumentListener = anchorTagListener(document);
  const spoilerImageDocumentListener = spoilerImageListener(document);
  // Kanji met are read once per opened book; new ones show up on the next open.
  const knownRuby =
    furiganaStyle === FuriganaStyle.Known
      ? loadKnownRubyCheck().catch(() => () => false)
      : undefined;

  return (contentEl: HTMLElement) =>
    merge(
      anchorTagDocumentListener(contentEl),
      knownRuby
        ? from(knownRuby).pipe(
            switchMap((hide) => merge(...markKnownRuby(contentEl, hide).map(toggleRuby)))
          )
        : rubyTagListener(contentEl, furiganaStyle),
      spoilerImageDocumentListener(contentEl),
      openImageInNewTab(contentEl, hideSpoilerImage, isExtendedMode)
    );
}

function anchorTagListener(document: Document) {
  return (contentEl: HTMLElement) => {
    const anchorTags = Array.from(contentEl.getElementsByTagName('a'));
    anchorTags.forEach((el) => {
      el.href = document.location.pathname + el.hash;
    });

    const obs$ = anchorTags.map((el) =>
      fromClickEvent(el).pipe(tap(() => nextChapter$.next(el.hash.substring(1))))
    );
    return merge(...obs$);
  };
}

function rubyTagListener(contentEl: HTMLElement, furiganaStyle: FuriganaStyle) {
  if (furiganaStyle === FuriganaStyle.Hide) {
    return NEVER;
  }

  const isToggle = furiganaStyle === FuriganaStyle.Toggle || furiganaStyle === FuriganaStyle.Hover;
  const rubyTags = Array.from(contentEl.getElementsByTagName('ruby'));
  const obs$ = rubyTags.map((el) =>
    isToggle
      ? toggleRuby(el)
      : fromClickEvent(el).pipe(
          take(1),
          tap(() => {
            el.classList.add('reveal-rt');
          })
        )
  );
  return merge(...obs$);
}

function toggleRuby(el: Element) {
  return fromClickEvent(el).pipe(
    tap(() => {
      el.classList.toggle('reveal-rt');
    })
  );
}

function spoilerImageListener(document: Document) {
  return (contentEl: HTMLElement) => {
    const elements = Array.from(contentEl.querySelectorAll('[data-ttu-spoiler-img]'));
    const obs$ = elements.map((el) => {
      const spoilerLabelEl = document.createElement('span');
      spoilerLabelEl.title = 'Show Image';
      spoilerLabelEl.classList.add('spoiler-label');
      spoilerLabelEl.setAttribute('aria-hidden', 'true');
      spoilerLabelEl.innerText = 'ネタバレ';
      el.appendChild(spoilerLabelEl);

      const imageElement = el.querySelector('img,image');

      toggleImageGalleryPictureSpoiler(imageElement, false);

      return fromClickEvent(el).pipe(
        take(1),
        tap(() => {
          el.removeChild(spoilerLabelEl);
          el.removeAttribute('data-ttu-spoiler-img');

          imageElement?.classList.add('ttu-unspoilered');

          toggleImageGalleryPictureSpoiler(imageElement, true);
        })
      );
    });
    return merge(...obs$);
  };
}

function openImageInNewTab(
  contentEl: HTMLElement,
  hideSpoilerImage: boolean,
  isExtendedMode: boolean
) {
  return merge(
    ...[...contentEl.querySelectorAll<HTMLElement>(`${isExtendedMode ? 'img,' : ''}image`)].map(
      (elm) => {
        elm.draggable = false;

        return merge(
          fromEvent(elm, 'contextmenu').pipe(
            tap((event) => {
              if (isExtendedMode) {
                event.preventDefault();
              }
            })
          ),
          fromEvent(elm, 'pointerdown').pipe(
            switchMap((event) => {
              const { clientX, clientY } = event as PointerEvent;

              return timer(1000).pipe(
                takeUntil(
                  race(
                    fromEvent(elm, 'pointermove').pipe(
                      throttleTime(200, undefined, { trailing: true }),
                      filter((event2) => {
                        const { clientX: newX, clientY: newY } = event2 as PointerEvent;

                        return Math.abs(clientX - newX) > 5 || Math.abs(clientY - newY) > 5;
                      })
                    ),
                    fromEvent(elm, 'pointerup'),
                    fromEvent(elm, 'pointercancel')
                  )
                )
              );
            }),
            filter(
              () =>
                !hideSpoilerImage ||
                elm.classList.contains('ttu-unspoilered') ||
                !elm.closest('span[data-ttu-spoiler-img]')
            ),
            switchMap(() => {
              pulseElement(
                elm.parentElement && elm.tagName.toLowerCase() === 'image'
                  ? elm.parentElement
                  : elm,
                'add',
                0.5,
                500
              );

              return merge(fromEvent(elm, 'pointerup'), fromEvent(elm, 'pointercancel')).pipe(
                take(1),
                tap(() => {
                  const src = elm.getAttribute('src') || elm.getAttribute('href');

                  if (src) {
                    window.open(src, '_blank');
                  }
                })
              );
            })
          )
        );
      }
    )
  );
}

function toggleImageGalleryPictureSpoiler(imageElement: Element | null, unspoilered: boolean) {
  if (imageElement instanceof HTMLImageElement) {
    toggleImageGalleryPictureSpoiler$.next({ url: imageElement.src, unspoilered });
  } else if (imageElement && 'href' in imageElement) {
    toggleImageGalleryPictureSpoiler$.next({
      url: (imageElement.href as SVGAnimatedString).baseVal,
      unspoilered
    });
  }
}

function fromClickEvent(el: Element) {
  return fromEvent(el, 'click').pipe(
    tap((ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    })
  );
}
