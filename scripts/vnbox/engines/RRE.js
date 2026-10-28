// RRE.js: LunaHook's RRE engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RRE.cpp and RRE.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function SpecialRunrunEngine(context, hp, buffer) {
    const eax = context.eax; // *(DWORD *)(esp_base - 0x8)
    const edx = context.edx; // *(DWORD *)(esp_base - 0x10)
    const addr = (eax + edx) >>> 0; // eax + edx
    buffer.from_t(L.u16(addr), 2);
}

function InsertRREHook() {
    const addr = L.findCallAddress(L.FindFunction('IsDBCSLeadByte'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig = 0x51c3;
    const hp = { address: addr, type: L.NO_CONTEXT | L.DATA_INDIRECT | L.USING_CHAR };
    if (L.u16(addr - 2) !== sig) {
        hp.text_fun = SpecialRunrunEngine;
        return L.NewHook(hp, 'RunrunEngine Old');
    }
    hp.offset = L.regoffset('eax');
    return L.NewHook(hp, 'RunrunEngine');
}

const E = L.engine({
    name: 'RRE',
    check: { FILE: 'rrecfg.rcf' },
    attach() { return InsertRREHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
