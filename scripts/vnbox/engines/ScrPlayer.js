// ScrPlayer.js: LunaHook's ScrPlayer engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ScrPlayer.cpp and ScrPlayer.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function ScrPlayer_attach_function1() {
    let func = L.findCallerAddress(L.FindFunction('GetGlyphOutlineA'), 0x90909090, L.processStartAddress, L.processStopAddress);
    if (func === 0) return false;
    func += 4;
    const check = [
        0x83, 0xf8, 0x20,
        0x74, XX,
        0x3d, 0x40, 0x81, 0x00, 0x00,
        0x74, XX];
    let addr = L.findBytes(check, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    if (addr !== func) return false;
    let idx = 0; // static int idx
    return L.NewHook({
        address: func,
        offset: L.stackoffset(5),
        // 会把多行分开导致翻译不对。
        type: L.USING_STRING,
        filter_fun(buffer) {
            if (idx % 2) buffer.clear();
            idx += 1; // 这个函数总是连续被调用两次，一个绘制上层文字，一个绘制阴影。
        },
    }, 'ScrPlayer');
}

function ScrPlayer_attach_function2() {
    // https://vndb.org/v7056
    // Rendezvous ～ランデブー～
    //  _DWORD *__stdcall sub_41DC10(_DWORD *a1, int a2, int a3, int a4, int a5, unsigned __int8 *a6 <---, int a7, int a8, int a9, char a10, int a11)
    const bs = [
        0x51,
        0x56,
        0x8b, 0x74, 0x24, 0x20,
        0x8a, 0x06,
        0x84, 0xc0,
        0x89, 0x4c, 0x24, 0x04,
        0x0f, 0x84, ...L.XX4];
    const addr = L.findBytes(bs, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(6), type: L.USING_STRING }, 'ScrPlayer2');
}

const E = L.engine({
    name: 'ScrPlayer',
    check: { FILE: 'ScrPlayer.exe' },
    attach() { return ScrPlayer_attach_function1() || ScrPlayer_attach_function2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
