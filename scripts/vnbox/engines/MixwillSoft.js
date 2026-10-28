// MixwillSoft.js: LunaHook's MixwillSoft engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/MixwillSoft.cpp and MixwillSoft.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'MixwillSoft',
    // 实际进程为r2/r2.exe
    check: { FILE_ALL: ['r2/r2.exe', 'dat/snd*.arc', 'dat/res*.arc', 'dat/tex*.arc', 'dat/txt*.arc'] },
    attach() {
        // https://vndb.org/v10193
        const bytes = [
            // mov eax, [esp+5ECh+var_5C4]; mov [esp+5ECh+var_4], 2; test eax, eax; jnz; mov eax, offset String;
            // mov ecx, [esp+5ECh+var_5C0]; cmp byte ptr [eax+ecx-1], 5Ch; jnz; lea eax, [ecx-1]; cmp eax, ecx
            0x8B, 0x44, 0x24, 0x28,
            0xC7, 0x84, 0x24, 0xE8, 0x05, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
            0x85, 0xC0,
            0x75, 0x05,
            0xB8, 0x40, 0xA5, 0x59, 0x00,
            0x8B, 0x4C, 0x24, 0x2C,
            0x80, 0x7C, 0x08, 0xFF, 0x5C,
            0x75, 0x21,
            0x8D, 0x41, 0xFF,
            0x3B, 0xc1];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        // Not ported: the comment that embedding overflows the length (embed is out of scope).
        return L.NewHook({
            address: addr + 4 + 11 + 2 + 2 + 5,
            offset: L.regoffset('eax'),
            type: L.USING_STRING,
            filter_fun(buffer) {
                if (buffer.viewA().endsWith('/')) buffer.size -= 1;
            },
        }, 'MixwillSoft');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
