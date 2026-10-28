// AGE_System.js: LunaHook's AGE_System engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AGE_System.cpp and AGE_System.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function findx() {
    // 已破解
    let addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, true, 0x1d); // mov ebx, ds:GetGlyphOutlineA
    if (addr) return addr;
    // 未破解
    // v8 = _mbsnextc(String);
    const sig = [
        0x8b, 0x4c, 0x24, 0x04,
        0x33, 0xd2,
        0x0f, 0xb6, 0x01,
        0xf6, 0x80, ...XX4, 0x04,
        0x74, 0x06,
        0xc1, 0xe0, 0x08,
        0x8b, 0xd0,
        0x41,
        0x0f, 0xb6, 0x01,
        0x03, 0xc2,
        0xc3];
    addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return 0;
    const addr2 = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addr2.length !== 2) return 0;
    return addr2[1];
}

const E = L.engine({
    name: 'AGE_System',
    check: () => L.CheckFileAll(['Agrd.pac', 'vic.pac', 'se.pac', 'mus.pac']) || // 未破解
        L.SearchResourceString('AGE_System'), // 已破解
    attach() {
        //(18禁ゲーム) [170331] [ルネ] ようこそ！ スケベエルフの森へ パッケージ版
        let addr = findx();
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        const addr2 = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr + 0x1000, 0xe8);
        if (addr2.length !== 1) return false;
        const addr21 = L.findEnclosingAlignedFunction(addr2[0]);
        if (!addr21) return false;
        return L.NewHook({ address: addr21, offset: L.stackoffset(3), type: L.USING_STRING }, 'AGE_System');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
