// shyakunage.js: LunaHook's shyakunage engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/shyakunage.cpp and shyakunage.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'shyakunage',
    check: { FILE: 'image.dat' },
    certain: false,
    attach() {
        // しゃくなげ
        const bytes = [0x25, 0xff, 0xff, 0x00, 0x00, 0xc1, 0xe8, 0x04];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.USING_STRING }, 'shyakunage');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
