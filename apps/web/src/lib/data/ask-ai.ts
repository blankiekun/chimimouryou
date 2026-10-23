/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Ask AI" about a passage through the connection chosen in Settings → AI
 * (ai-client.ts). Not part of upstream.
 */

import { aiPrompts } from '$lib/data/ai-prompts';
import { chat } from '$lib/data/ai-client';
import { askAiReaderNote$, type AiTextFeature } from '$lib/data/ai-settings';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PassageContext {
  bookTitle: string;
  before: string;
  selection: string;
  after: string;
}

export function buildPassagePrompt(passage: PassageContext, question: string) {
  return `Book: ${passage.bookTitle}

<text_before>
${passage.before}
</text_before>

<selected_passage>
${passage.selection}
</selected_passage>

<text_after>
${passage.after}
</text_after>

${question || aiPrompts().defaultQuestion}`;
}

export interface AskAiOptions {
  /** Feature whose connection, model and settings are used (Settings → AI → Features) */
  feature?: AiTextFeature;
  /** System prompt instead of the passage helper prompt */
  system?: string;
}

/**
 * Asks the feature's model (Ask AI unless set), calling onText with the answer so
 * far, and returns the conversation including the answer.
 */
export async function askAi(
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal,
  options: AskAiOptions = {}
): Promise<ChatMessage[]> {
  const note = askAiReaderNote$.getValue().trim();
  const system = options.system || (note ? `${aiPrompts().ask}\n\n${note}` : aiPrompts().ask);
  const text = await chat(
    options.feature ?? 'ask',
    [{ role: 'system', content: system }, ...messages],
    onText,
    signal
  );

  return [...messages, { role: 'assistant', content: text }];
}
