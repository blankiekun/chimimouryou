// RUNE.js: LunaHook's RUNE engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RUNE.cpp and RUNE.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function RUNE1() {
    const bytes = [
        // 恋する妹はせつなくてお兄ちゃんを想うとすぐＨしちゃうの  （Ver.1.02）
        // Ricotte～アルペンブルの歌姫～
        // 初恋
        // 思春期
        // Fifth
        // unsigned __int8 *__cdecl _mbsinc(const unsigned __int8 *Ptr)
        0x8B, 0x44, 0x24, 0x04,
        0x0F, 0xB6, 0x08,
        0x8A, 0x89, ...XX4,
        0x80, 0xE1, 0x04,
        0x40,
        0x84, 0xC9,
        0x74, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.CODEC_ANSI_BE }, 'RUNE');
}

function RUNE2() {
    // ANGEL CORE
    let addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig1 = [0x81, 0xe1, 0x01, 0x00, 0x00, 0x80, ...XX2, 0x49, 0x83, 0xc9, 0xfe, 0x41];
    const _ = L.findBytes(sig1, addr, addr + 0x100);
    if (_ === 0) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'RUNE');
}

function RUNE3() {
    // 雪のち、ふるるっ！～ところにより、恋もよう～
    const bytes = [0x6a, 0x05, 0x6a, 0x01];
    for (const addr of L.SearchMemory(bytes, L.PAGE_EXECUTE_READWRITE)) {
        const start = L.findEnclosingAlignedFunction(addr);
        if (start === 0) continue;
        const sig1 = [0x6a, 0x00, 0x6a, 0x01, 0x50];
        const sig2 = [0x6a, 0x34, 0xe8];
        const sig3 = [0xc1, 0xe2, 0x10, 0x0b, 0xc2];
        let ok = true;
        for (const p of [sig1, sig2, sig3]) {
            const _ = L.findBytes(p, start, addr);
            if (_ === 0) ok = false;
        }
        if (ok) return L.NewHook({ address: start, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'RUNE');
    }
    return false;
}

const E = L.engine({
    name: 'RUNE',
    check: { FILE_ALL: ['vorbis.acm', '*d*.g*'] },
    certain: false,
    attach() { return RUNE1() || RUNE2() || RUNE3(); },
});

module.exports = E;
if (!module.parent) L.run(E);
