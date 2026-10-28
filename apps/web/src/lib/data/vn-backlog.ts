/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A line the VN player keeps for Anki mining (overlay.js `keptLineList()`). */
export interface KeptLine {
  /** The page so far at a click wait (CONscripter) or one hooked line (VNBox) */
  text: string;
  /** Its screenshot is still kept */
  picture: boolean;
  /** Its sound (voice file or recording) is still kept */
  sound: boolean;
}

export interface BacklogLine extends KeptLine {
  /** Index in the player's kept lines, for its media */
  index: number;
}

/**
 * The /v Backlog sheet's lines, newest first. A page grows click by click, so each line shows
 * only the text its click wait added. A line kept again (a game's backlog screen re-firing the
 * hook) is listed once, where it was first read, with the newest copy's index and media.
 */
export function backlogLines(kept: KeptLine[]) {
  const byText = new Map<string, BacklogLine>();
  const lines: BacklogLine[] = [];

  kept.forEach((line, index) => {
    const before = index ? kept[index - 1].text : '';
    const text = (
      before && line.text.startsWith(before) ? line.text.slice(before.length) : line.text
    ).trim();
    const listed = byText.get(line.text);

    if (listed) {
      Object.assign(listed, { index, picture: line.picture, sound: line.sound });
    } else if (text) {
      const entry = { ...line, text, index };

      byText.set(line.text, entry);
      lines.push(entry);
    }
  });

  return lines.reverse();
}
