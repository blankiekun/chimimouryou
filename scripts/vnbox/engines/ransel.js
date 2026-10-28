// ransel.js: LunaHook's ransel engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ransel.cpp and ransel.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// [020726][苺みるく] たんぽぽ ～Everything Nice～ (bin+cue)
// HS-8@4B377C    int __fastcall sub_4B377C(int a1, char *a2)
// HS-1C@4BECCC   LRESULT __fastcall sub_4BECCC(HWND hWnd, WPARAM wParam, LPARAM a3, int a4) { return SendMessageA(hWnd, 0x102Eu, wParam, (LPARAM)lParam); }
const E = L.engine({
    name: 'ransel',
    check: { RESOURCE_STR: 'Adventure Game Engine' },
    certain: false,
    attach() {
        const sig = [
            XX,
            XX,
            0x68, 0x2e, 0x10, 0x00, 0x00,
            XX,
            0xe8, ...XX4, // SendMessageA->__imp_SendMessageA
        ];
        let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr, 0x20);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.regoffset('esi') }, 'ransel');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
