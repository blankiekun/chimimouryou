// Jisatu101.js: LunaHook's Jisatu101 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Jisatu101.cpp and Jisatu101.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Jisatu101',
    check: { FILE: '101.exe' },
    certain: false,
    attach() {
        const bytes = [
            // ジサツのための１０１の方法
            // https://vndb.org/v6475
            0x8b, 0x44, 0x24, 0x10,
            0x66, 0x0f, 0xb6, 0x08,
            0x66, 0x0f, 0xb6, 0x50, 0x01,

            0xC1, 0xE1, 0x08,
            0x03, 0xCA,
            0x66, 0x81, 0xF9, 0x0A, 0x0D,
            0x74];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x100);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(4), type: L.DATA_INDIRECT, index: 0 }, 'Jisatu101');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
