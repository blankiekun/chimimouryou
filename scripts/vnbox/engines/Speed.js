// Speed.js: LunaHook's Speed engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Speed.cpp and Speed.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'Speed',
    check: () => {
        const hcb = L.processName.substr(0, L.processName.length - 4) + '.hcb';
        return L.CheckFileAll([hcb, 'bgm.bin', 'cg.bin', 'se.bin', 'vo.bin']);
    },
    certain: false,
    attach() {
        // 藍色ノ狂詩曲～Deep Blue Rhapsody～
        // mov     esi, ds:DrawTextA
        let addr = L.findiatcallormov(L.FindFunction('DrawTextA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, false, 0x35);
        if (!addr) return false;
        const sig1 = [0x68, 0x00, 0x04, 0x00, 0x00];
        const sig2 = [0xFF, 0xD6];
        const sig3 = [0x68, 0x00, 0x01, 0x00, 0x00];
        const sig4 = [0xFF, 0xD6];
        for (const p of [sig1, sig2, sig3, sig4]) {
            addr = L.findBytes(p, addr, addr + 0x40);
            if (!addr) return false;
        }
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'Speed');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
