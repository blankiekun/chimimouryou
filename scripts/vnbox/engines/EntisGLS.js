// EntisGLS.js: LunaHook's EntisGLS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/EntisGLS.cpp and EntisGLS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function h2() {
    // 神学校 DL
    const bytes1 = [
        0x55,
        0x8b, 0xec,
        0x83, 0xec, 0x0c,
        0x8b, 0xc8,
        0x0f, 0xb7, 0x00,
        0x57,
        0x8b, 0x7d, 0x0c,
        0x89, 0x55, 0xfc,
        0x66, 0x85, 0xc0,
        0x74, XX,
        0xeb, 0x07,
        0x8d, 0xa4, 0x24, 0x00, 0x00, 0x00, 0x00,
        0x83, 0xc1, 0x02,
        0x89, 0x4d, 0xf4,
        0x66, 0x83, 0xf8, 0x0d];
    const addr = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.USING_STRING | L.CODEC_UTF16 }, 'EntisGLS');
}

function h1() {
    // それは舞い散る桜のように-完全版-
    // int __thiscall sub_4BB5D0(_BYTE *this, LPCWCH lpWideCharStr)
    const bytes1 = [
        0x66, 0x83, 0xF9, 0x41,
        0x72, 0x06,
        0x66, 0x83, 0xF9, 0x5a,
        0x76, 0x0C,
        0x66, 0x83, 0xF9, 0x61,
        0x72, 0x12,
        0x66, 0x83, 0xF9, 0x7a,
        0x77, 0x0c,
    ];
    let addr = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // embed_hook_font and embed flags left out (translation embedding)
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.CODEC_UTF16 }, 'EntisGLS');
}

const E = L.engine({
    name: 'EntisGLS',
    check: { FILE: 'Data\\*.dat' },
    certain: false,
    attach() { return h1() || h2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
