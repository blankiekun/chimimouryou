// RScript.js: LunaHook's RScript engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RScript.cpp and RScript.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

// https://vndb.org/v5096
// 行殺♥ 新選組　人斬り美少女あどべんちゃ～ (StringFileInfo: LiarSoft, WindWing RScript)
const E = L.engine({
    name: 'RScript',
    check: () => L.CheckFileAll(['grpe\\*.lim', 'grps\\*.lim', 'grpo\\*.lim', 'scr\\*.gsc']) &&
        L.SearchResourceString('RScript'),
    certain: false,
    attach() {
        // void __thiscall CSelTxtEx::SetSels(CSelTxtEx *this, char *a2): a '^' (94) starts a command
        const bytes = [
            0x80, 0x3f, 0x5e,
            0x0f, 0x85, ...XX4,
            0x8a, 0x47, 0x01,
            0x47, 0x84, 0xc0,
            0x0f, 0x84, ...XX4,
            0x0f, 0xbe, 0xc0,
            0x83, 0xc0, 0xbf,
            0x83, 0xf8, 0x32];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        const faddr = L.findEnclosingAlignedFunction(addr);
        if (!faddr) return false;
        const bytes2 = [
            0x8a, 0x07,
            0x84, 0xc0,
            0x0f, 0x84, ...XX4,
            0x0f, 0xbe, 0xd0,
            0x52,
            0xe8, ...XX4, // call __ismbblead
            0x83, 0xc4, 0x04,
            0x85, 0xc0,
            0x74, L.XX,
            0x0f, 0xbe, 0x47, 0x01,
            0x50,
            0xe8, ...XX4, // call __ismbbtrail
        ];
        const addrX = L.findBytes(bytes2, faddr, addr);
        if (!addrX) return false;
        // Left out: the patch_fun_ptrs that replace __ismbblead/__ismbbtrail (b != '^'), a code patch.
        return L.NewHook({
            address: faddr,
            offset: L.stackoffset(1),
            type: L.USING_STRING,
            lineSeparator: '^n',
        }, 'RScript');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
