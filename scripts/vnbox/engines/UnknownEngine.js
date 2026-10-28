// UnknownEngine.js: LunaHook's UnknownEngine engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/UnknownEngine.cpp and UnknownEngine.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const E = L.engine({
    name: 'UnknownEngine',
    check: { FILE: '*.aqa' },
    certain: false,
    attach() {
        // ABANDONER - THE SEVERED DREAMS
        // https://vndb.org/v1182
        const bytes = [
            0x8B, 0x44, 0x24, 0x04,
            0x85, 0xC0,
            0x75, 0x03,
            0xC2, 0x08, 0x00,
            0x33, 0xD2,
            0x8A, 0x50, 0x01,
            0x8A, 0x30,
            0x8B, 0xC2,
            0x50,
            0xE8, ...XX4,
            0xC2, 0x08, 0x00];
        const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
        let succ = false;
        for (const addr of addrs) {
            succ = L.NewHook({ address: addr, offset: L.stackoffset(1), index: 0, type: L.DATA_INDIRECT }, 'Unknown') || succ;
        }
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
