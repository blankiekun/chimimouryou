// H_do_C.js: LunaHook's H_do_C engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/H_do_C.cpp and H_do_C.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://vndb.org/v565
// 夢見師
function nomal() {
    const call = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, false, XX);
    if (!call) return false;
    const sig = [0xB8, 0x68, 0x24, 0x00, 0x00];
    const addr = L.reverseFindBytes(sig, call - 0x100, call);
    if (!addr) return false;
    const as = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (as.length !== 2) return false;
    const as0 = L.findEnclosingAlignedFunction(as[0]);
    const as1 = L.findEnclosingAlignedFunction(as[1]);
    if (as0 !== as1) return false;
    if (!as0) return false;
    return L.NewHook({ address: as0, offset: L.stackoffset(2), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'H_do_C');
}
function embed() {
    const sig = [
        0x8a, 0x03,
        0x3c, 0x7c,
        0x0f, 0x84, ...XX4,
        0x3c, 0x80,
        0x72, 0x0b,
        0x83, 0xc6, 0x02,
        0x83, 0xc3, 0x02,
        0xe9, ...XX4,
        0x3c, 0x5c,
        0x0f, 0x85, ...XX4,
        0x8a, 0x43, 0x01,
        0x83, 0xc3, 0x01,
        0x83, 0xc6, 0x01,
        0x3c, 0x31];
    let succ = false;
    for (let addr of L.SearchMemory(sig, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        succ = L.NewHook({ address: addr, offset: L.regoffset('ecx'), type: L.USING_STRING, lineSeparator: '||' }, 'H_do_C') || succ;
    }
    return succ;
}

const E = L.engine({
    name: 'H_do_C',
    check: () => L.CheckFile('*.pak') && L.SearchResourceString('(C) Ｈ℃'),
    attach() { return embed() | nomal(); },
});

module.exports = E;
if (!module.parent) L.run(E);
