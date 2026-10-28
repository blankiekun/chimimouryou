// PinkQuestion.js: LunaHook's PinkQuestion engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/PinkQuestion.cpp and PinkQuestion.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// ぴんくはてな\魔法少女ナユタ
const E = L.engine({
    name: 'PinkQuestion',
    check: { FILE_ALL: ['nayuta.exe', 'data.0*'] },
    attach() {
        const bytes2 = [
            0x3d, 0x9f, 0x82, 0x00, 0x00,
            0xbd, 0x02, 0x00, 0x00, 0x00,
            0x7c, XX,
            0x3d, 0xf1, 0x82, 0x00, 0x00,
            0x7f, XX,
            0x33, 0xed,
            0x3d, 0x41, 0x81, 0x00, 0x00,
            0x7c, XX,
            0x3d, 0x9a, 0x82, 0x00, 0x00,
            0x7e, XX,
            0x3d, 0x40, 0x83, 0x00, 0x00,
            0x7c, XX,
            0x3d, 0x8f, 0x87, 0x00, 0x00,
            0x7f, XX];
        let addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x20);
        if (!addr) return false;
        const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
        if (addrs.length !== 1) return false;
        addr = L.findEnclosingAlignedFunction(addrs[0], 0x40);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.USING_CHAR | L.DATA_INDIRECT, offset: L.stackoffset(3) }, 'PinkQuestion');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
