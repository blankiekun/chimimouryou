// AGS.js: LunaHook's AGS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AGS.cpp and AGS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertAGSHook() {
    const bytes1 = [
        // push ebp; mov ebp, esp; sub esp, 38h; push ebx; push esi; mov esi, ecx
        0x55,
        0x8b, 0xec,
        0x83, 0xec, 0x38, 0x53, 0x56, 0x8b, 0xf1];
    const addr = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const bytes2 = [
        // push [ebp+arg_0]; mov ecx, esi; call sub_43E3A0
        0xff, 0x75, 0x08,
        0x8b, 0xce];
    let ok = false;
    const addrs = L.findrelativecall(bytes2, bytes2.length, addr, L.processStartAddress, L.processStopAddress);
    for (let a of addrs) {
        a = L.findfuncstart(a);
        if (!a) continue;
        ok = L.NewHook({ address: a, offset: L.regoffset('eax'), type: L.USING_STRING }, 'HOOK_AGS') || ok;
    }
    return ok;
}

function hook2() {
    // 誘惑女教師～熟れた蜜の味～
    for (const addr of L.findiatcallormov_all(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE)) {
        const funcaddr = L.findfuncstart(addr, 0x1000);
        if (!funcaddr) continue;
        const sig1 = [0x68, 0x00, 0x80, 0x00, 0x00, 0x6a, 0x00];
        const sig2 = [0x2D, 0xC0, 0x00, 0x00, 0x00, 0xC1, 0xE0, 0x08];
        const sig3 = [0x83, 0xC0, 0x80, 0xC1, 0xE0, 0x08];
        const sig4 = [0x3C, 0xA0, 0x0F, 0xB6, 0xC0];
        let found = 0;
        for (const sig of [sig1, sig2, sig3, sig4]) {
            const fd = L.findBytes(sig, funcaddr, addr);
            if (fd) found += 1;
        }
        if (found === 4) {
            return L.NewHook({ address: funcaddr, type: L.DATA_INDIRECT, offset: L.stackoffset(1), index: 0 }, 'AGS');
        }
    }
    return false;
}

const E = L.engine({
    name: 'AGS',
    check: { FILE_ANY: ['voice/*.pk', 'sound/*.pk', 'misc/*.pk'] },
    certain: false,
    attach() {
        return InsertAGSHook() || hook2();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
