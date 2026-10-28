// GSX.js: LunaHook's GSX engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GSX.cpp and GSX.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function GSX1() {
    // https://vndb.org/v7585
    // PersonA ～オペラ座の怪人～ 体验版
    const addr = L.findCallerAddress(L.FindFunction('GetCharWidth32W'), 0xec8b55, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_CHAR | L.CODEC_UTF16 | L.DATA_INDIRECT, offset: L.stackoffset(4) }, 'GSX');
}
function GSX2() {
    L.hookGDIFunctions(L.FindFunction('GetTextExtentPoint32A'));
    L.hookGDIFunctions(L.FindFunction('TextOutA'));
    // https://vndb.org/v1930 星の王女, v1931, v2989, v1952, v1400, v856
    const GetGlyphOutlineA = L.FindFunction('GetGlyphOutlineA');
    let addr = L.findiatcallormov(GetGlyphOutlineA, L.processStartAddress, L.processStartAddress, L.processStopAddress, false, XX);
    if (!addr) addr = L.findiatcallormov(GetGlyphOutlineA, L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    let addr1 = L.findfuncstart(addr);
    let addr2 = L.findEnclosingAlignedFunction(addr);
    addr = addr1 ? addr1 : addr2;
    if (!addr) return false;
    const xrefs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (xrefs.length !== 2) return false;
    addr = xrefs[1];
    addr1 = L.findfuncstart(addr, 0x180);
    addr2 = L.findEnclosingAlignedFunction(addr);
    addr = addr1 ? addr1 : addr2;
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR,
        text_fun(context, hp, buffer, split) {
            let d;
            if (L.IsBadReadPtr(context.stack[3], 4)) d = L.u16(context.stack[4]);
            else d = L.u16(context.stack[3]);
            buffer.from_t(d, 2);
        },
    }, 'GSX');
}

const E = L.engine({
    name: 'GSX',
    check: { RESOURCE_STR: 'Game Script eXecuter' },
    attach() { return GSX1() || GSX2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
