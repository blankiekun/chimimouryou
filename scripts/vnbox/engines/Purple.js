// Purple.js: LunaHook's Purple engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Purple.cpp and Purple.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E1 = L.engine({
    name: 'Purple',
    check: { FILE_ALL: ['WAIT.TAM', 'data.hed', 'data.dat'] },
    attach() {
        // 夢幻 虚実と真実
        // 世界の果ての物語
        const funcs = [
            0xCCCCCCCC,
            0xec8b55,
        ];
        let addr = L.findMultiCallerAddress(L.FindFunction('GetGlyphOutlineA'), funcs, funcs.length, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        if (L.u32(addr) === 0xCCCCCCCC) addr += 4;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'Purple');
    },
});

const E2 = L.engine({
    name: 'Purple2',
    check: { FILE_ALL: ['misc\\*.pk', 'music\\*.px'] },
    attach() {
        // はっぴ～ぶり～でぃんぐ    https://vndb.org/p132
        // 夏色小町
        // はぴぶり いまさら ふぁんでぃすく
        let addr = L.findCallerAddress(L.FindFunction('TextOutA'), 0x90909090, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr += 4;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), index: 0, type: L.DATA_INDIRECT }, 'Purple2');
    },
});

module.exports = [E1, E2];
if (!module.parent) { L.run(E1); L.run(E2); }
