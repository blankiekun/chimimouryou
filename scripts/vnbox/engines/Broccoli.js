// Broccoli.js: LunaHook's Broccoli engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Broccoli.cpp and Broccoli.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Broccoli',
    check: { FILE_ALL: ['voice*.pak', 'voice.pak', 'data.pak', 'data*.pak'] },
    certain: false,
    attach() {
        // char check[] = "...": sizeof counts the terminating NUL
        if (!L.findBytes(L.aToBytes('KaraokeMesPutCt %d, MojiCt %d\0'), L.processStartAddress, L.processStopAddress)) return false;
        const bytes = [
            0x8b, 0x0d, ...XX4,
            0x89, 0x44, 0x24, XX,
            0xa1, ...XX4,
            0x89, 0x4c, 0x24, XX,
            0x89, 0x44, 0x24, XX];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr + bytes.length - 8,
            offset: L.regoffset('ecx'),
            filter_fun(buffer) { if (buffer.viewA() === '\\') buffer.clear(); },
        }, 'Broccoli');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
