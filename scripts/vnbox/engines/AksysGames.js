// AksysGames.js: LunaHook's AksysGames engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AksysGames.cpp and AksysGames.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'AksysGames',
    check: { RESOURCE_STR: 'Aksys Games' },
    certain: false,
    attach() {
        // v8 = *v2; if ( *v2 == (char)0x80 ) ... if ( (unsigned __int8)v8 >= 0x81u && <= 0x9Fu || >= 0xE0u && <= 0xFCu )
        // mov cl, [eax]; cmp cl, 80h; jz; xor esi, esi; mov [ebp+var_20C], edi; mov [ebp+var_214], eax; mov ebx, edx;
        // test edi, edi; jz; cmp cl, 81h; jb; cmp cl, 9Fh; jbe; cmp cl, 0E0h; jb; cmp cl, 0FCh; ja
        const bytes = [
            0x8a, 0x08,
            0x80, 0xf9, 0x80,
            0x0f, 0x84, ...XX4,
            0x33, 0xf6,
            0x89, XX, ...XX4,
            0x89, XX, ...XX4,
            0x8b, 0xda,
            0x85, 0xff,
            0x74, XX,
            0x80, 0xf9, 0x81,
            0x72, XX,
            0x80, 0xf9, 0x9f,
            0x76, XX,
            0x80, 0xf9, 0xe0,
            0x72, XX,
            0x80, 0xf9, 0xfc,
            0x77, XX];
        const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
        if (!addr) return false;
        addr = L.findfuncstart(addr, 0x100, true);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'AksysGames');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
