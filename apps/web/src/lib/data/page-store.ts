/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '$app/env';
import { page as pageState } from '$app/state';
import { toStore, type Readable } from 'svelte/store';

const read = () => ({ url: pageState.url, route: pageState.route, state: pageState.state });

const clientPage = browser ? toStore(read) : undefined;

/**
 * `$app/stores`' `page` (removed in SvelteKit 3) for Svelte 4 syntax components: `$:` statements
 * don't see changes to `$app/state`'s `page`, but they do see a store. A new object on every change.
 * On the server (prerendering) the page lives in the component context, so it is read on subscribe.
 */
export const page: Readable<ReturnType<typeof read>> = clientPage ?? {
  subscribe(run) {
    run(read());
    return () => {};
  }
};
