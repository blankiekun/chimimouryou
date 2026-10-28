// SYSD.js: LunaHook's SYSD engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/SYSD.cpp and SYSD.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function InsertSysdHook() {
    /*
     * Sample games:
     * https://vndb.org/v2069
     */
    const bytes = [
        0xC1, 0xE9, 0x02,            // shr ecx,02      <- hook here
        0xF3, 0xA5,                  // repe movsd
        0x8B, 0xCA,                  // mov ecx,edx
        0x83, 0xE1, 0x03,            // and ecx,03
        0xF3, 0xA4,                  // repe movsb
        0x5F,                        // pop edi
        0xB8, 0x01, 0x00, 0x00, 0x00 // mov eax,00000001
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('esi'),
        index: 0,
        padding: 0x12,
        split: L.stackoffset(2),
        split_index: 0,
        type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT,
        filter_fun(buffer) { L.CharFilterA(buffer, '\n'); },
    }, 'Sysd');
}

const E = L.engine({
    name: 'SYSD',
    check: { FILE_ALL: ['*.dpk', 'SYSD.INI'] },
    certain: false,
    attach() { return InsertSysdHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
