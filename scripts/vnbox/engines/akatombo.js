// akatombo.js: LunaHook's akatombo engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/akatombo.cpp and akatombo.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'akatombo',
    check: { RESOURCE_STR: 'akatombo' },
    certain: false,
    attach() {
        let addr = L.findBytes('3C 80 72 ?? 3C 9F 76 ?? 3C E0 72 ?? 3C EF 77 ??', L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr, 0x200);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'akatombo');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
