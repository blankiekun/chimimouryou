// AZScript.js: LunaHook's AZScript engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AZScript.cpp and AZScript.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'AZScript',
    // the files alone do not pass this check (&&), so no `files` hint for the page
    check: () => L.CheckFileAll(['scenario.axr', 'bgm.axr', 'cg.axr', 'movie.axr', 'voice.axr', 'se.axr']) &&
        L.SearchResourceString('AZScript/VNEngine'),
    certain: false,
    attach() {
        const bytes = [
            0x8B, 0x44, 0x24, 0x10,
            0x56,
            0x8B, 0x74, 0x24, 0x08,
            0x6A, 0x00,
            0x50,
            0x56,
            0xE8, ...XX4,
            0x83, 0xC4, 0x0C,
            0x85, 0xC0,
            0x7C, XX,
            0x8B, 0x4E, XX,
            0x8D, 0x54, 0x24, 0x1C,
            0x51,
            0x52,
            0xE8, ...XX4,
            0x85, 0xC0,
            0x74, XX];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(6), type: L.USING_STRING }, 'AZScript');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
