// BKEngine.js: LunaHook's BKEngine engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/BKEngine.cpp and BKEngine.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// https://bke.bakery.moe/download.html
function _1() {
    const sig = [0x64, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x8b, 0xf1, 0x8b, 0x45, 0x08, 0x0f, 0x57, 0xc0, 0xc7, 0x06, 0x02, 0x00, 0x00, 0x00];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_UTF16 | L.DATA_INDIRECT, index: 0, offset: L.stackoffset(1) }, 'BKEngine1');
}

function _2() {
    const sig = [0xb8, 0xff, 0x00, 0x00, 0x00, 0x66, 0x3b, 0x06, 0x1b, 0xc0, 0xf7, 0xd8, 0x40];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_UTF16 | L.DATA_INDIRECT | L.NO_CONTEXT, index: 0, offset: L.stackoffset(1) }, 'BKEngine2');
}

function _3() {
    const sig = [0x6a, 0xff, 0x6a, 0x00, 0x56];
    const mp = new Map();
    let maxaddr = 0;
    let maxi = 0;
    for (let addr of L.SearchMemory(sig, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        if (!mp.has(addr)) mp.set(addr, 0);
        mp.set(addr, mp.get(addr) + 1);
        if (mp.get(addr) > maxi) {
            maxi = mp.get(addr);
            maxaddr = addr;
        }
    }
    if (maxaddr === 0) return false;
    return L.NewHook({ address: maxaddr, type: L.CODEC_UTF16 | L.USING_STRING, offset: L.regoffset('edx') }, 'BKEngine3');
}

const E = L.engine({
    name: 'BKEngine',
    certain: false,
    check: { FILE: '*.bkarc' },
    attach() {
        let ok = _1();
        ok = _2() || ok;
        ok = _3() || ok;
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
