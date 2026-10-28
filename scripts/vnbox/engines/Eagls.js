// Eagls.js: LunaHook's Eagls engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Eagls.cpp and Eagls.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 7/26/2014: E.A.G.L.S engine for TechArts games (SQUEEZ, May-Be Soft)
 *  Two functions calls to GetGlyphOutlineA are responsible for painting (0x4094ef, 0x409e35).
 *  However, by default, one of the thread is like: scenario namename scenario
 *  The other thread have infinite loop.
 */
function InsertEaglsHook() {
    // Modify the split for GetGlyphOutlineA
    return L.NewHook({
        address: L.FindFunction('GetGlyphOutlineA'),
        type: L.CODEC_ANSI_BE | L.USING_SPLIT, // the only difference is the split value
        offset: L.stackoffset(2),
        split: L.stackoffset(4),
    }, 'EAGLS');
}

const E = L.engine({
    name: 'Eagls',
    check: { FILE: 'EAGLS.dll' },
    attach() { return InsertEaglsHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
