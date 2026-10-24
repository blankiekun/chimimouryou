/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {computeZoomScale, isPointInAnyRect} from './document-util.js';
import {DOMTextScanner} from './dom-text-scanner.js';

// chimimouryou: the text path of `TextSourceGenerator.getRangeFromPoint` as a function:
// `_caretRangeFromPoint`, `_caretPositionFromPoint` and `_isPointInRange`. Left out: imposters
// for inputs and textareas, shadow roots, images and the deep DOM scan (the app only scans its
// own text). The document is a parameter so a same-origin frame's text can be scanned.

/**
 * @param {number} x
 * @param {number} y
 * @param {boolean} normalizeCssZoom
 * @param {Document} [doc]
 * @returns {?Range}
 */
export function getRangeFromPoint(x, y, normalizeCssZoom, doc = document) {
    const range = caretRangeFromPoint(x, y, doc);
    if (range === null) { return null; }
    return isPointInRange(x, y, range, normalizeCssZoom) ? range : null;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Range} range
 * @param {boolean} normalizeCssZoom
 * @returns {boolean}
 */
function isPointInRange(x, y, range, normalizeCssZoom) {
    // Require a text node to start
    const {startContainer} = range;
    if (startContainer.nodeType !== Node.TEXT_NODE) {
        return false;
    }

    // Convert CSS zoom coordinates
    if (normalizeCssZoom) {
        const scale = computeZoomScale(startContainer);
        x /= scale;
        y /= scale;
    }

    // Scan forward
    const nodePre = range.endContainer;
    const offsetPre = range.endOffset;
    try {
        const {node, offset, content} = new DOMTextScanner(nodePre, offsetPre, true, false).seek(1);
        range.setEnd(node, offset);

        if (!isWhitespace(content) && isPointInAnyRect(x, y, range.getClientRects(), 'ja', null)) {
            return true;
        }
    } finally {
        range.setEnd(nodePre, offsetPre);
    }

    // Scan backward
    const {node, offset, content} = new DOMTextScanner(startContainer, range.startOffset, true, false).seek(-1);
    range.setStart(node, offset);

    if (!isWhitespace(content) && isPointInAnyRect(x, y, range.getClientRects(), 'ja', null)) {
        // This purposefully leaves the starting offset as modified and sets the range length to 0.
        range.setEnd(node, offset);
        return true;
    }

    // No match
    return false;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Document} doc
 * @returns {?Range}
 */
function caretRangeFromPoint(x, y, doc) {
    if (typeof doc.caretPositionFromPoint === 'function') {
        // Firefox
        // 128+ Chrome, Edge
        const caretPositionFromPointResult = caretPositionFromPoint(x, y, doc);
        // Older Chromium based browsers (such as Kiwi) pretend to support `caretPositionFromPoint` but it doesn't work
        // Allow falling through if `caretPositionFromPointResult` is null to let `caretRangeFromPoint` be used in these cases
        if (caretPositionFromPointResult) {
            return caretPositionFromPointResult;
        }
    }

    if (typeof doc.caretRangeFromPoint === 'function') {
        // Fallback Chrome, Edge
        return doc.caretRangeFromPoint(x, y);
    }

    // No support
    return null;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Document} doc
 * @returns {?Range}
 */
function caretPositionFromPoint(x, y, doc) {
    const position = doc.caretPositionFromPoint(x, y);
    if (position === null) {
        return null;
    }
    const node = position.offsetNode;
    if (node === null) {
        return null;
    }

    let offset = 0;
    if (node.nodeType === Node.TEXT_NODE) {
        offset = position.offset;
    }

    try {
        const range = doc.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset);
        return range;
    } catch (e) {
        // Firefox throws new DOMException("The operation is insecure.")
        // when trying to select a node from within a ShadowRoot.
        return null;
    }
}

/**
 * @param {string} string
 * @returns {boolean}
 */
function isWhitespace(string) {
    return string.trim().length === 0;
}
