// Palette.js: LunaHook's Palette engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Palette.cpp and Palette.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'Palette',
    check: { FILE: 'data\\*.pak' },
    certain: false,
    attach() {
        const sig2 = [
            // さくらシュトラッセ
            // さくらんぼシュトラッセ
            // MERI+DIA～マリアディアナ～
            0x8b, XX,
            0x8b, XX, 0x14,
            0x03, XX,
            0x3b, XX,
            0x76, XX,
            0x83, XX, 0x10,
            0x72, XX,
            0x8b, XX,
            0x8b, XX, 0x24, 0x14,
            XX,
            0x2b, XX,
            XX,
            XX,
            0x8b, XX,
            0xe8, ...XX4,
            XX,
            XX,
            XX,
            0xC2, 0x08, 0x00];
        const m = L.GetModuleHandle('system.dll');
        let addr = 0;
        if (m) {
            // もしも明日が晴れならば
            // えむぴぃ
            const [minAddress, maxAddress] = L.QueryModuleLimits(m);
            addr = L.findBytes(sig2, minAddress, maxAddress);
        } else {
            addr = L.findBytes(sig2, L.processStartAddress, L.processStopAddress);
        }
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING, filter_fun: L.all_ascii_Filter }, 'Palette');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
