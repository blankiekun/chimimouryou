// Footy2.js: LunaHook's Footy2 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Footy2.cpp and Footy2.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function insertstrcpyhook() {
    const bytes = [
        0x3B, 0xD8, 0x72, 0x45, 0x83, 0xF9, 0x10, 0x72, 0x04, 0x8B, 0x16, 0xEB, 0x02];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    const funcstart = [
        0x55, 0x8b, 0xec, 0x53, 0x8b, 0x5d, 0x08];
    for (let addr of addrs) {
        addr = L.reverseFindBytes(funcstart, addr - 0x100, addr);
        if (!addr) continue;
        L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'strcpy');
    }
    return false; // as in LunaHook: succ is computed but false is returned
}

const E = L.engine({
    name: 'Footy2',
    certain: false,
    check: { FILE: 'Footy2.dll' },
    attach() {
        // ガールズ・ブック・メイカー -幸せのリブレット-
        return insertstrcpyhook();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
