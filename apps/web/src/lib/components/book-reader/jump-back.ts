/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';

/**
 * "Back" after a jump (search, Contents, a link in the book, Return to bookmark, highlights…):
 * the character count the reader was at before it, until Back is used or dismissed. Jumps made
 * while Back is shown keep the first place, so stepping through search results still returns to
 * where reading stopped. The Listen follow isn't a jump and never calls `jumped`.
 */
export class JumpBack {
  readonly origin$ = new BehaviorSubject<number | undefined>(undefined);

  // Created before the readers mount, so this runs before they move to the chapter.
  private chapterJumps = nextChapter$.subscribe(() => this.jumped());

  constructor(
    private here: () => number | undefined,
    private go: (count: number) => void
  ) {}

  /** Call before the jump moves the page. */
  jumped() {
    if (this.origin$.getValue() === undefined) this.origin$.next(this.here());
  }

  back() {
    const origin = this.origin$.getValue();
    this.origin$.next(undefined);
    if (origin !== undefined) this.go(origin);
  }

  dismiss() {
    this.origin$.next(undefined);
  }

  destroy() {
    this.chapterJumps.unsubscribe();
  }
}
