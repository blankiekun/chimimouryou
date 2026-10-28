// Nijyuei.js: LunaHook's Nijyuei engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nijyuei.cpp and Nijyuei.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const E = L.engine({
    name: 'Nijyuei',
    check: { FILE: 'Nijyuei.kpd' },
    attach() {
        // 二重影
        const bytes = [
            0xE8, ...XX4,
            0x85, 0xc0,
            0x0f, 0x85, ...XX4,
            0x5f, 0x5e, 0x5d, 0x5b,
            0x81, 0xC4, 0x0C, 0x01, 0x00, 0x00,
            0xC3,
        ];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr + 5, type: L.USING_STRING, offset: L.regoffset('edx') }, 'Nijyuei');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
