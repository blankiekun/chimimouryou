// TSSystem.js: LunaHook's TSSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TSSystem.cpp and TSSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'TSSystem',
    check: () => L.processName.includes('TSSystem') || L.CheckFile('TSSystem.exe'),
    files: ['TSSystem.exe'],
    certain: false,
    attach() {
        // D-EVE in you
        // トロピカルKISS
        const bytes = [
            0xB9, 0x42, 0x00, 0x00, 0x00,
            0xF3, 0xA5];
        let ok = false;
        const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
        for (let addr of addrs) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            ok = L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'TSSystem') || ok;
        }
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
