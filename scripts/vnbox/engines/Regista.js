// Regista.js: LunaHook's Regista engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Regista.cpp and Regista.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX2, XX4 } = L;

// ルートダブル -Before Crime * After Days-
function old() {
    const bytes = [
        0x8a, 0x10, 0x83, 0xC0, 0x04, 0x83, 0xc1, 0x04, 0x84, 0xd2, 0x74];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x40);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.DATA_INDIRECT, index: 0 }, 'Regista');
}

function _2() {
    let succ = false;
    const bytes = [
        // old不是很好，old是strcmp，有很多乱七八糟的，这个是脚本的一些控制字符判断和shiftjis范围判断。
        0x80, 0xF9, 0x81,
        ...XX2,
        0x80, 0xF9, 0x9F,
        ...XX2,
        0x80, 0xF9, 0xE0,
        ...XX2,
        0x80, 0xF9, 0xFC];
    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        const start = [0xCC, 0xCC, 0xCC, 0xCC];
        addr = L.reverseFindBytes(start, addr - 0x40, addr, 4);
        if (!addr) continue;
        const check = [
            0x8b, 0x15, ...XX4, // mov     edx, dword_3EA6904
            0x8a, 0x0a, // mov     cl, [edx]
        ];
        if (L.MatchPattern(addr, check)) addr += 6;
        succ = L.NewHook({
            address: addr,
            offset: L.regoffset('edx'),
            type: L.USING_STRING,
            filter_fun(buffer) {
                // ……黒く、冷たい銃口と、%Nもっと冷たい、黒い瞳が……
                buffer.fromA(L.re.sub(buffer.strA(), '%[Nn]', ''));
            },
        }, 'Regista2') || succ;
    }
    return succ;
}

const E = L.engine({
    name: 'Regista',
    check: { FILE: 'data\\*.afs' },
    certain: false,
    attach() { return _2() || old(); },
});

module.exports = E;
if (!module.parent) L.run(E);
