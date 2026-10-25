/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import PointBox from './point-box.svelte';
import SectionHead from './section-head.svelte';

type Legacy = new (options: { target: Element; props: object }) => { $set(props: object): void };

// Runes components are typed as functions; `compatibility.componentApi: 4` makes them classes too.
function mount(Component: unknown, props: object) {
  const target = document.createElement('div');
  const component = new (Component as Legacy)({ target, props });
  return Object.assign(target, { component });
}

describe('SectionHead', () => {
  it('shows a two-digit number, the title as a heading and the count', () => {
    const target = mount(SectionHead, { number: 2, title: 'Continue reading', count: 5 });

    expect(target.querySelector('.section-head-number')?.textContent).toBe('02');
    expect(target.querySelector('h2')?.textContent).toBe('Continue reading');
    expect(target.querySelector('.section-head-count')?.textContent).toBe('5');
  });

  it('leaves the count out when there is none and takes another heading level', () => {
    const target = mount(SectionHead, { number: 12, title: 'Read next', level: 'h3' });

    expect(target.querySelector('.section-head-number')?.textContent).toBe('12');
    expect(target.querySelector('h3')?.textContent).toBe('Read next');
    expect(target.querySelector('.section-head-count')).toBeNull();
  });

  // SectionHead is a runes component: Svelte 4's $set still reaches its $props.
  it('updates when its props change', () => {
    const target = mount(SectionHead, { number: 1, title: 'Old' });

    target.component.$set({ number: 3, title: 'New' });
    flushSync();

    expect(target.querySelector('.section-head-number')?.textContent).toBe('03');
    expect(target.querySelector('h2')?.textContent).toBe('New');
  });
});

describe('PointBox', () => {
  it('names the box by its label and groups the figure', () => {
    const target = mount(PointBox, { label: 'Today', figure: 12345, unit: 'chars' });
    const box = target.querySelector('section');

    expect(box?.getAttribute('aria-label')).toBe('Today');
    expect(box?.querySelector('.point-box-tag')?.textContent).toBe('Today');
    expect(box?.querySelector('.point-box-figure')?.textContent?.trim()).toBe('12,345chars');
    expect(box?.querySelector('.point-box-unit')?.textContent).toBe('chars');
  });

  it('shows a text figure as given, without a unit', () => {
    const target = mount(PointBox, { label: 'Streak', figure: '—' });

    expect(target.querySelector('.point-box-figure')?.textContent?.trim()).toBe('—');
    expect(target.querySelector('.point-box-unit')).toBeNull();
  });
});
