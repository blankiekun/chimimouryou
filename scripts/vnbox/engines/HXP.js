// HXP.js: LunaHook's HXP engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/HXP.cpp and HXP.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'HXP',
    check: { FILE: 'DATA\\*.HXP' },
    certain: false,
    attach() {
        // https://vndb.org/v172
        // エクソダスギルティー・オルタナティブ
        let addr = L.findCallerAddress(L.FindFunction('TextOutA'), 0x01003d66, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.CODEC_ANSI_BE }, 'HXP');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
