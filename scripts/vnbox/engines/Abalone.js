// Abalone.js: LunaHook's Abalone engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Abalone.cpp and Abalone.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Abalone',
    check: { FILE: 'Archive.dat' },
    certain: false,
    attach() {
        const addr = L.findBytes('8B 44 24 ?? 80 38 00 74', L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr + 4, offset: L.regoffset('eax'), type: L.DATA_INDIRECT, index: 0 }, 'AbaloneHook');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
