// TEANAM.js: LunaHook's TEANAM engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TEANAM.cpp and TEANAM.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

/**
 * せ・ん・せ・い 生声
 */
const E = L.engine({
    name: 'TEANAM',
    check: { StringFileInfo: 'TEANAM' },
    attach() {
        const bytes = [
            0x56,                   // push esi
            0x8b, 0xf1,             // mov esi, ecx
            0x8b, 0x4e, 0x64,       // mov ecx, dword ptr [esi + 0x64]
            0x85, 0xc9,             // test ecx, ecx
            0x0f, 0x84,             // je ...      ← 后跟 rel32, 通配
            XX, XX, XX, XX,         //
            0x8b, 0x44, 0x24, 0x10, // mov eax, dword ptr [esp + 0x10]  ; eax = lpString
            0x8b, 0x56, 0x40,       // mov edx, dword ptr [esi + 0x40]
            0x53, 0x55, 0x57,       // push ebx; push ebp; push edi
            0x8b, 0x7c, 0x24, 0x18, // mov edi, dword ptr [esp + 0x18]
            0x8b, 0x5c, 0x24, 0x14, // mov ebx, dword ptr [esp + 0x14]
            0x50,                   // push eax
            0x8b, 0x46, 0x4c,       // mov eax, dword ptr [esi + 0x4c]
            0x52,                   // push edx
            0x8a, 0x56, 0x44,       // mov dl, byte ptr [esi + 0x44]
        ];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(3) }, 'TEANAM');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
