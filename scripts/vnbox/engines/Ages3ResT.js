// Ages3ResT.js: LunaHook's Ages3ResT engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Ages3ResT.cpp and Ages3ResT.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function Ages3ResTHook() {
    // 会直接提取多语言
    const bytes = [
        0x8d, 0x4f, XX,
        0xff, 0x15, ...XX4,
        XX,
        0x8d, 0x8f, ...XX4,
        0xff, 0x15, ...XX4,
        0x8d, XX, ...XX4,
        XX,
        0x8d, 0x8f, ...XX4,
        0xff, 0x15, ...XX4,
        0x8b, XX,
        0xff, 0x15, ...XX4];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (let addr of addrs) {
        addr = L.findfuncstart(addr);
        if (!addr) continue;
        succ = L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.CODEC_UTF16 | L.USING_STRING | L.FULL_STRING }, 'Ages3ResT') || succ;
    }
    return succ;
}

function Ages3ResTHook_1() {
    const sig1 = [
        0x81, 0x7d, 0x08, 0x11, 0x30, 0x00, 0x00, // cmp [ebp+8],0x3011
    ];
    const sig2 = [
        // mov esi, [ebp+arg_0]; cmp esi, 20h; jz; cmp esi, 0A0h; jz; cmp esi, 3000h; jz
        0x8b, 0x75, 0x08,
        0x83, 0xfe, 0x20,
        0x0f, 0x84, ...XX4,
        0x81, 0xfe, 0xa0, 0x00, 0x00, 0x00,
        0x0f, 0x84, ...XX4,
        0x81, 0xfe, 0x00, 0x30, 0x00, 0x00,
        0x0f, 0x84, ...XX4];
    const addrs = L.SearchMemory(sig2, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (const addr2 of addrs) {
        const addr = L.findfuncstart(addr2);
        if (!addr) continue;
        if (!L.findBytes(sig1, addr, addr2)) continue;
        succ = L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_UTF16 | L.USING_CHAR }, 'Ages3ResT2') || succ;
    }
    return succ;
}

const E = L.engine({
    name: 'Ages3ResT',
    check: { FILE: 'Ages3ResT.dll' },
    attach() {
        // C++ `|` runs both hooks
        const a = Ages3ResTHook();
        return Ages3ResTHook_1() || a;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
