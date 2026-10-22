/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { coverThumbUrl } from './calibre';

describe('coverThumbUrl', () => {
  it('points library and game covers at their thumbnails, nothing else', () => {
    expect(coverThumbUrl('/calibre/library/A/B%20(1)/cover.jpg')).toBe(
      '/calibre/thumbs/library/A/B%20(1)/cover.jpg'
    );
    expect(coverThumbUrl('/calibre/vn/Game/cover.png')).toBe('/calibre/thumbs/vn/Game/cover.png');
    expect(coverThumbUrl('https://s4.anilist.co/x.jpg')).toBe('https://s4.anilist.co/x.jpg');
  });
});
