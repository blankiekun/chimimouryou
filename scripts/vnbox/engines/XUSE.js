// XUSE.js: LunaHook's XUSE engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/XUSE.cpp and XUSE.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertXUSEHook2() {
    L.hookGDIFunctions(L.FindFunction('GetCharABCWidthsA')); // 神様のゲーム
    const bytes = [
        0x68, 0x34, 0x01, 0x00, 0x00,
    ];
    let succ = false;
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    for (const addr of addrs) {
        succ = L.NewHook({
            address: addr,
            offset: L.regoffset('eax'),
            type: L.CODEC_ANSI_BE | L.NO_CONTEXT | L.USING_SPLIT,
            split: 0,
            filter_fun(buffer) {
                const s = buffer.strA();
                if ([...s].every((c) => c === '\0' || c === ' ')) buffer.clear();
            },
        }, 'XUSE2') || succ;
    }
    return succ;
}

function InsertXUSEHook() {
    const bytes = [
        0x6a, 0x00,
        XX,
        0x6a, 0x05,
        XX,
        XX,
        0xff, 0x15, ...XX4,
        0x8b, 0xf0,
        0x83, 0xfe, 0xff,
    ];
    let succ = false;
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    for (const addr of addrs) {
        succ = L.NewHook({
            address: addr + 7,
            offset: L.regoffset('edi'),
            type: L.CODEC_ANSI_BE | L.NO_CONTEXT | L.USING_SPLIT,
            split: L.stackoffset(3),
        }, 'XUSE') || succ;
    }
    return succ;
}

function xuse_2(addr) {
    let refs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (refs.length !== 2) return false;
    const a1 = L.findEnclosingAlignedFunction(refs[0]);
    const a2 = L.findEnclosingAlignedFunction(refs[1]);
    if (a1 !== a2) return false;
    if (!a1) return false;
    refs = L.findxref_reverse_checkcallop(a1, L.processStartAddress, L.processStopAddress, 0xe8);
    if (refs.length !== 3) return false;
    addr = refs[refs.length - 1];
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // embed_hook_font (F_GetGlyphOutlineA | DISABLE_FONT_SWITCH) left out
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(8),
        type: L.USING_STRING,
    }, 'XUSE');
}

function xuse_1(xaddr) {
    const imp = L.FindImportEntry(L.processStartAddress, L.FindFunction('IsDBCSLeadByteEx'));
    if (!imp) return xuse_2(xaddr);
    const bytes = [0x51, 0x68, 0xA4, 0x03, 0x00, 0x00, 0xFF, 0x15, ...L.le32(imp), 0x85, 0xC0];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(8),
        type: L.USING_STRING,
    }, 'XUSE');
}

function xusex() {
    const bytes = [
        0x55, 0x8b, 0xec,
        0x83, 0x7d, 0x1c, 0x07,
        0x72, 0x07,
        0xc7, 0x45, 0x1c, 0x06, 0x00, 0x00, 0x00,
        0x83, 0x7d, 0x1c, 0x04,
        0x73, 0x2c,
        0x8b, 0x45, 0x24,
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    if (xuse_1(addr)) return true;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(5),
        type: L.USING_CHAR | L.CODEC_ANSI_BE,
    }, 'XUSE');
}

const E = L.engine({
    name: 'XUSE',
    check: { FILE: 'CD/BV*' },
    certain: false,
    attach() { return xusex() || InsertXUSEHook() || InsertXUSEHook2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
