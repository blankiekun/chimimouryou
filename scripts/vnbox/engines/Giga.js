// Giga.js: LunaHook's Giga engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Giga.cpp and Giga.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Giga',
    check: { FILE: 'Dat\\*.pac' },
    attach() {
        const bytes = [
            // ショコラ ~maid cafe curio Re-order~
            // https://vndb.org/v682
            0xe8, ...XX4,
            0x83, 0xC4, 0x10,
            0xB8, 0x01, 0x00, 0x00, 0x00,
            0x81, 0xC4, 0x00, 0x10, 0x00, 0x00,
            0xC3];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr, 0x100);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(4), type: L.USING_STRING }, 'Giga');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
