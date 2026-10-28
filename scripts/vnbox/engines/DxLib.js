// DxLib.js: LunaHook's DxLib engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/DxLib.cpp and DxLib.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function DxLibFilter(buffer) {
    L.StringCharReplacerA(buffer, '%N', ' ');
    L.StringFilterA(buffer, '%K');
    L.StringFilterA(buffer, '%P');
}

function InsertDxLibHook() {
    /*
     * Sample games:
     * https://vndb.org/v7849
     * https://vndb.org/v10231
     */
    const bytes = [
        0xF7, 0xC6, ...XX4, // test esi,00000003      << hook here
        0x75, XX, // jne BookofShadows.exe+15FE54
        0x8B, 0xD9, // mov ebx,ecx
        0xC1, 0xE9, 0x02, // shr ecx,02
        0x75, XX, // jne BookofShadows.exe+15FEAE
        0xEB, XX, // jmp BookofShadows.exe+15FE76
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('esi'), type: L.USING_STRING, filter_fun: DxLibFilter }, 'DxLib');
}

const E = L.engine({
    name: 'DxLib',
    check: { FILE: '*.bcx' },
    certain: false,
    attach() { return InsertDxLibHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
