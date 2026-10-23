/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Small formatters for Settings → AI. Not part of upstream. */

import type { AiConnectionTest, AiModel } from '$lib/data/ai-connections';
import type { AiProvider } from '$lib/data/ai-providers';
import { tr } from '$lib/i18n';

/** `sk-or-v1-····3f9a`: enough to tell keys apart, never the whole key. */
export function keyTail(key: string) {
  if (!key) {
    return '';
  }

  return key.length > 14 ? `${key.slice(0, 8)}····${key.slice(-4)}` : `····${key.slice(-4)}`;
}

/** "today 14:02", "yesterday", "3 days ago" */
export function whenTested(at: number, now = Date.now()) {
  const day = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(at)) / 86_400_000);

  if (days <= 0) {
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return tr('ai.today', { time });
  }

  return days === 1 ? tr('ai.yesterday') : tr('ai.daysAgo', { count: days });
}

/** Colour of a test result's dot: works, needs attention, failed, or waiting for a key. */
export function testTone(test: Pick<AiConnectionTest, 'ok' | 'title'>) {
  if (test.ok) {
    return 'ok';
  }

  if (/^(Key refused|Couldn't reach|Blocked)/.test(test.title)) {
    return 'error';
  }

  return /^Needs/.test(test.title) ? 'muted' : 'warn';
}

export function formatPrice(price: number | undefined) {
  if (price === undefined) {
    return '';
  }

  return price === 0
    ? '$0'
    : `$${price < 0.1 ? price.toFixed(3).replace(/0$/, '') : price.toFixed(2)}`;
}

export function formatContext(tokens: number | undefined) {
  if (!tokens) {
    return '';
  }

  return tokens >= 1_000_000
    ? `${+(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1000)}k`;
}

/** 'free', 'trains' (free, and the text may be used for training) or '' */
export function freeTag(provider: AiProvider | undefined, model: AiModel | undefined) {
  if (!provider || !model?.free) {
    return '';
  }

  return provider.free === 'trains' || model.id.endsWith(':free') ? 'trains' : 'free';
}
