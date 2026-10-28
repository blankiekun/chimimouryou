// GameMaker.js: LunaHook's GameMaker engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GameMaker.cpp and GameMaker.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertGameMakerHook() {
    /*
     * Sample games:
     *   VA-11 Hall A
     */
    const bytes = [
        0x85, 0xF6, // test esi,esi
        0x74, XX, // je "VA-11 Hall A.exe"+D5014
        0x85, 0xC0, // test eax,eax
        0x74, XX, // je "VA-11 Hall A.exe"+D5014
        0x50, // push eax
        0x56, // push esi          << hook here
    ];
    const addr_offset = bytes.length - 1;
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.NO_CONTEXT,
        filter_fun(buffer) { L.CharFilterA(buffer, '#'); },
    }, 'GameMaker');
}

const E = L.engine({
    name: 'GameMaker',
    check: { FILE: 'GMResource.dll' },
    certain: false,
    attach() { return InsertGameMakerHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
