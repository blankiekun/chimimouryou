// Stronger.js: LunaHook's Stronger engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Stronger.cpp and Stronger.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// https://vndb.org/v1334
// Pygmalion ~The Dark Romance~
function h1() {
    let addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, false, 0x3d); // mov edi, ds:GetGlyphOutlineA
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addrs.length !== 1) return false;
    addr = addrs[0];
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.DATA_INDIRECT | L.USING_CHAR }, 'Stronger');
}

const E = L.engine({
    name: 'Stronger',
    check: { FILE: 'data/sinario/*.spt' },
    certain: false,
    attach() { return h1(); },
});

module.exports = E;
if (!module.parent) L.run(E);
