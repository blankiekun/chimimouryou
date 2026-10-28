// AZSystem.js: LunaHook's AZSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AZSystem.cpp and AZSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'AZSystem',
    check: { FILE_ALL: ['voice.arc', 'music.arc', 'script.arc', 'sound.arc', 'sysgraph.arc', 'system.arc', 'graphic.arc'] },
    certain: false,
    attach() {
        const addr = L.findBytes('8a 1f 8a c3 34 20 04 5f 3c 3b 77 15 66 8b 17 8b ?? ?? ?? b9 02 00 00 00 66 89 54 24 10 03 f9',
            L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.regoffset('edi'), type: L.USING_STRING }, 'AZSystem');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
