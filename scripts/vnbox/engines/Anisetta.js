// Anisetta.js: LunaHook's Anisetta engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Anisetta.cpp and Anisetta.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Anisetta',
    check: { FILE_ANY: ['*.pd', '.pb'] },
    certain: false,
    attach() {
        let addr = L.findBytes('F7 D8 1B C0 25 58 02 00 00 05 90 01 00 00', L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.CODEC_ANSI_BE, offset: L.stackoffset(5) }, 'Anisetta');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
