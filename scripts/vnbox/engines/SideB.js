// SideB.js: LunaHook's SideB engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/SideB.cpp and SideB.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// jichi 8/2/2014 side-B
// Sample games: [side-B] メルトピア -- /HS-4@B4452:Martopia.exe (off -0x8, type 0x41)
// The function (push ebp at 00f64410) takes the text as arg1 ([esp+4]); the C++ comment holds its disassembly.
// 8/2/2014 jichi: Copyright is side-B, a conf.dat will be generated after the game is launched.
// It also contains lua5.1.dll and lua5.dll.
function InsertSideBHook() {
    const bytes = [
        0x64, 0xa3, 0x00, 0x00, 0x00, 0x00,       // 00f64435   64:a3 00000000   mov dword ptr fs:[0],eax
        0x8b, 0xf9,                               // 00f6443b   8bf9             mov edi,ecx
        0x8b, 0x4d, 0x08,                         // 00f6443d   8b4d 08          mov ecx,dword ptr ss:[ebp+0x8]
        0x33, 0xdb,                               // 00f64440   33db             xor ebx,ebx
        0x3b, 0xcb,                               // 00f64442   3bcb             cmp ecx,ebx
        0x74, 0x40,                               // 00f64444   74 40            je short martopia.00f64486
        0x8b, 0xc1,                               // 00f64446   8bc1             mov eax,ecx
        0xc7, 0x45, 0xe8, 0x0f, 0x00, 0x00, 0x00, // 00f64448   c745 e8 0f000000 mov dword ptr ss:[ebp-0x18],0xf
        0x89, 0x5d, 0xe4,                         // 00f6444f   895d e4          mov dword ptr ss:[ebp-0x1c],ebx
        0x88, 0x5d, 0xd4,                         // 00f64452   885d d4          mov byte ptr ss:[ebp-0x2c],bl
    ];
    const addr_offset = 0x00f64410 - 0x00f64435; // distance to the beginning of the function
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = (addr + addr_offset) >>> 0;
    const push_ebp = 0x55; // 011d4c80  /$ 55             push ebp
    if (L.u8(addr) !== push_ebp) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1), // [esp+4] == arg1
        type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT, // NO_CONTEXT && RELATIVE_SPLIT to get rid of floating return address
        split: 0, // use retaddr as split
    }, 'SideB');
}

const E = L.engine({
    name: 'SideB',
    check: { RESOURCE_STR: 'side-B' },
    attach() { return InsertSideBHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
