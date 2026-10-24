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

// chimimouryou: the popup placement of app/popup.js (`Popup._getPosition` and the helpers it
// calls), as functions. The frame size and offsets come in `options` instead of the instance;
// no content scale (the popup is part of the page).

/**
 * @param {import('./popup-position').Rect[]} sourceRects
 * @param {import('../dom/document-util').NormalizedWritingMode} writingMode
 * @param {import('./popup-position').Rect} viewport
 * @param {import('./popup-position').PopupPositionOptions} options
 * @returns {import('./popup-position').SizeRect}
 */
export function getPosition(sourceRects, writingMode, viewport, options) {
    const frameWidth = options.width;
    const frameHeight = options.height;

    const horizontal = (writingMode === 'horizontal-tb' || options.verticalTextPosition === 'default');
    let preferAfter;
    let horizontalOffset;
    let verticalOffset;
    if (horizontal) {
        preferAfter = options.horizontalTextPositionBelow;
        horizontalOffset = options.horizontalOffset;
        verticalOffset = options.verticalOffset;
    } else {
        preferAfter = isVerticalTextPopupOnRight(options.verticalTextPosition, writingMode);
        horizontalOffset = options.horizontalOffset2;
        verticalOffset = options.verticalOffset2;
    }

    /** @type {?import('./popup-position').SizeRect} */
    let best = null;
    const sourceRectsLength = sourceRects.length;
    for (let i = 0, ii = (sourceRectsLength > 1 ? sourceRectsLength : 0); i <= ii; ++i) {
        const sourceRect = i < sourceRectsLength ? sourceRects[i] : getBoundingSourceRect(sourceRects);
        const result = (
            horizontal ?
            getPositionForHorizontalText(sourceRect, frameWidth, frameHeight, viewport, horizontalOffset, verticalOffset, preferAfter) :
            getPositionForVerticalText(sourceRect, frameWidth, frameHeight, viewport, horizontalOffset, verticalOffset, preferAfter)
        );
        if (i < ii && isOverlapping(result, sourceRects, i)) { continue; }
        if (best === null || result.height > best.height) {
            best = result;
            if (result.height >= frameHeight) { break; }
        }
    }
    // Given the loop conditions, this is guaranteed to be non-null
    return /** @type {import('./popup-position').SizeRect} */ (best);
}

/**
 * @param {import('./popup-position').Rect} sourceRect
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {import('./popup-position').Rect} viewport
 * @param {number} horizontalOffset
 * @param {number} verticalOffset
 * @param {boolean} preferBelow
 * @returns {import('./popup-position').SizeRect}
 */
function getPositionForHorizontalText(sourceRect, frameWidth, frameHeight, viewport, horizontalOffset, verticalOffset, preferBelow) {
    const [left, width, after] = getConstrainedPosition(
        sourceRect.right - horizontalOffset,
        sourceRect.left + horizontalOffset,
        frameWidth,
        viewport.left,
        viewport.right,
        true,
    );
    const [top, height, below] = getConstrainedPositionBinary(
        sourceRect.top - verticalOffset,
        sourceRect.bottom + verticalOffset,
        frameHeight,
        viewport.top,
        viewport.bottom,
        preferBelow,
    );
    return {left, top, width, height, after, below};
}

/**
 * @param {import('./popup-position').Rect} sourceRect
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {import('./popup-position').Rect} viewport
 * @param {number} horizontalOffset
 * @param {number} verticalOffset
 * @param {boolean} preferRight
 * @returns {import('./popup-position').SizeRect}
 */
function getPositionForVerticalText(sourceRect, frameWidth, frameHeight, viewport, horizontalOffset, verticalOffset, preferRight) {
    const [left, width, after] = getConstrainedPositionBinary(
        sourceRect.left - horizontalOffset,
        sourceRect.right + horizontalOffset,
        frameWidth,
        viewport.left,
        viewport.right,
        preferRight,
    );
    const [top, height, below] = getConstrainedPosition(
        sourceRect.bottom - verticalOffset,
        sourceRect.top + verticalOffset,
        frameHeight,
        viewport.top,
        viewport.bottom,
        true,
    );
    return {left, top, width, height, after, below};
}

/**
 * @param {string} positionPreference
 * @param {import('../dom/document-util').NormalizedWritingMode} writingMode
 * @returns {boolean}
 */
function isVerticalTextPopupOnRight(positionPreference, writingMode) {
    switch (positionPreference) {
        case 'before':
            return !isWritingModeLeftToRight(writingMode);
        case 'after':
            return isWritingModeLeftToRight(writingMode);
        case 'right':
            return true;
        // case 'left':
        default:
            return false;
    }
}

/**
 * @param {import('../dom/document-util').NormalizedWritingMode} writingMode
 * @returns {boolean}
 */
function isWritingModeLeftToRight(writingMode) {
    switch (writingMode) {
        case 'vertical-lr':
        case 'sideways-lr':
            return true;
        default:
            return false;
    }
}

/**
 * @param {number} positionBefore
 * @param {number} positionAfter
 * @param {number} size
 * @param {number} minLimit
 * @param {number} maxLimit
 * @param {boolean} after
 * @returns {[position: number, size: number, after: boolean]}
 */
function getConstrainedPosition(positionBefore, positionAfter, size, minLimit, maxLimit, after) {
    size = Math.min(size, maxLimit - minLimit);

    let position;
    if (after) {
        position = Math.max(minLimit, positionAfter);
        position = position - Math.max(0, (position + size) - maxLimit);
    } else {
        position = Math.min(maxLimit, positionBefore) - size;
        position = position + Math.max(0, minLimit - position);
    }

    return [position, size, after];
}

/**
 * @param {number} positionBefore
 * @param {number} positionAfter
 * @param {number} size
 * @param {number} minLimit
 * @param {number} maxLimit
 * @param {boolean} after
 * @returns {[position: number, size: number, after: boolean]}
 */
function getConstrainedPositionBinary(positionBefore, positionAfter, size, minLimit, maxLimit, after) {
    const overflowBefore = minLimit - (positionBefore - size);
    const overflowAfter = (positionAfter + size) - maxLimit;

    if (overflowAfter > 0 || overflowBefore > 0) {
        after = (overflowAfter < overflowBefore);
    }

    let position;
    if (after) {
        size -= Math.max(0, overflowAfter);
        position = Math.max(minLimit, positionAfter);
    } else {
        size -= Math.max(0, overflowBefore);
        position = Math.min(maxLimit, positionBefore) - size;
    }

    return [position, size, after];
}

/**
 * @param {import('./popup-position').Rect[]} sourceRects
 * @returns {import('./popup-position').Rect}
 */
function getBoundingSourceRect(sourceRects) {
    switch (sourceRects.length) {
        case 0: return {left: 0, top: 0, right: 0, bottom: 0};
        case 1: return sourceRects[0];
    }
    let {left, top, right, bottom} = sourceRects[0];
    for (let i = 1, ii = sourceRects.length; i < ii; ++i) {
        const sourceRect = sourceRects[i];
        left = Math.min(left, sourceRect.left);
        top = Math.min(top, sourceRect.top);
        right = Math.max(right, sourceRect.right);
        bottom = Math.max(bottom, sourceRect.bottom);
    }
    return {left, top, right, bottom};
}

/**
 * @param {import('./popup-position').SizeRect} sizeRect
 * @param {import('./popup-position').Rect[]} sourceRects
 * @param {number} ignoreIndex
 * @returns {boolean}
 */
function isOverlapping(sizeRect, sourceRects, ignoreIndex) {
    const {left, top} = sizeRect;
    const right = left + sizeRect.width;
    const bottom = top + sizeRect.height;
    for (let i = 0, ii = sourceRects.length; i < ii; ++i) {
        if (i === ignoreIndex) { continue; }
        const sourceRect = sourceRects[i];
        if (
            left < sourceRect.right &&
            right > sourceRect.left &&
            top < sourceRect.bottom &&
            bottom > sourceRect.top
        ) {
            return true;
        }
    }
    return false;
}
