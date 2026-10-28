// MBSTRUTH.js: LunaHook's MBSTRUTH engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/MBSTRUTH.cpp and MBSTRUTH.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'MBSTRUTH',
    check: { FILE_ALL: ['game.001', 'game.002', 'game.dat'] },
    certain: false,
    attach() {
        //[030228][MBS TRUTH] DOOP ADVANCE
        const bytes = [
            0x55,
            0x8b, 0xec,
            0x81, 0xc4, ...XX4,
            0x53,
            0x56,
            0x57,
            0x33, 0xdb,
            0x89, 0x9d, ...XX4,
            0x89, 0x4d, XX,
            0x8b, 0xf2,
            0x89, 0x45, XX,
            0x8b, 0x5d, 0x08,
            0x33, 0xc0,
            0x55,
            0x68, ...XX4,
            0x64, 0xff, 0x30,
            0x64, 0x89, 0x20,
            0x8b, 0x45, 0x0c];
        const address = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        // the C++ hooks even when nothing was found (address 0); NewHook then fails
        if (!address) return false;
        return L.NewHook({ address, offset: L.regoffset('edx'), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'MBSTRUTH');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
