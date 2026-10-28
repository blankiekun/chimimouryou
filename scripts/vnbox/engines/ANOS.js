// ANOS.js: LunaHook's ANOS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ANOS.cpp and ANOS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

const E = L.engine({
    name: 'ANOS',
    check: { FILE_ALL: ['anos.dat', 'MOVIE/*.AVI', 'MP3/*.MP3'] },
    certain: false,
    attach() {
        const bytes = [
            0x8A, 0x01,
            0x33, 0xF6,
            0x3C, 0x81,
            0x57,
            0x89, 0x74, 0x24, XX,
            0x89, 0x74, 0x24, XX,
            0x72, XX,
            0x3C, 0x83,
            0x77, XX,
            0x25, 0xFF, 0x00, 0x00, 0x00,
            0x33, 0xD2,
            0x8A, 0x51, 0x01];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x20);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_CHAR | L.DATA_INDIRECT }, 'ANOS');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
