// RpgmXP.js: LunaHook's RpgmXP engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RpgmXP.cpp and RpgmXP.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function InsertRpgmXPHook() {
    /*
     * Sample games:
     * セントヘレナ(RJ137364)
     */
    return L.NewHook({
        module: 'gdi32.dll',
        function: 'GetGlyphOutlineW',
        address: 0,
        offset: L.stackoffset(2), // arg2
        index: 0,
        split: L.regoffset('esi'),
        split_index: 0,
        type: L.CODEC_UTF16 | L.USING_SPLIT | L.MODULE_OFFSET | L.FUNCTION_OFFSET,
    }, 'RpgmXP');
}

const E = L.engine({
    name: 'RpgmXP',
    check: { FILE: '*.rgssad' },
    certain: false,
    attach() { return InsertRpgmXPHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
