// KISS.js: LunaHook's KISS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/KISS.cpp and KISS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font.
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

function InsertKissHook() {
    // https://vndb.org/v1767
    const bytes = [
        0xC1, 0xE9, 0x02,       // shr ecx,02      <- hook here
        0xF3, 0xA5,             // repe movsd
        0x8B, 0xCA,             // mov ecx,edx
        0x55,                   // push ebp
        0x83, 0xE1, 0x03,       // and ecx,03
        0xF3, 0xA4,             // repe movsb
        0x8D, 0x4C, 0x24, 0x18, // lea ecx,[esp+18]
        0xE8, ...XX4,           // call kano.exe+6310
        0x8B, 0x0D, ...XX4      // mov ecx,[kano.exe+211F8C]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('esi'), type: L.USING_STRING | L.NO_CONTEXT }, 'Kiss');
}

const E = L.engine({
    name: 'KISS',
    check: { FILE: 'GameData\\script.ysb' },
    certain: false,
    attach() { return InsertKissHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
