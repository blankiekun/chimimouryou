// MBLMED.js: LunaHook's MBLMED engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/MBLMED.cpp and MBLMED.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// jichi 3/19/2014: Insert both hooks
// void InsertLuneHook()
function InsertMBLHook() {
    const fun = 0xec8b55; // jichi 10/20/2014: mov ebp,esp, sub esp,*
    let ret = false;
    const size = L.processStopAddress - L.processStartAddress;
    let c = L.FindCallOrJmpAbs(L.FindFunction('ExtTextOutA'), size, L.processStartAddress, true);
    if (c) {
        const addr = L.FindCallAndEntryRel(c, size, L.processStartAddress, fun);
        if (addr) {
            ret = L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'MBL-Furigana') || ret;
        }
    }
    c = L.FindCallOrJmpAbs(L.FindFunction('GetGlyphOutlineA'), size, L.processStartAddress, true);
    if (c) {
        const addr = L.FindCallAndEntryRel(c, size, L.processStartAddress, fun);
        if (addr) {
            ret = L.NewHook({ address: addr, offset: L.stackoffset(1), split: L.regoffset('esp'), type: L.CODEC_ANSI_BE | L.USING_SPLIT }, 'MBL') || ret;
        }
    }
    return ret;
}

function h1() {
    // https://vndb.org/v14141
    // おねがい助けて!! 2 ～注がれ続ける精液～
    const sig = L.aToBytes('\x81\x90\x82\x4f\x00\x81\x90\x82\x50\x00\x81\x90\x82\x51\x00\x81\x90\x82\x52\0');
    const asc_76BAAE = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!asc_76BAAE) return false;
    const bytes = [XX, ...L.le32(asc_76BAAE)]; // mov     edx, offset asc_76BAAE
    const push = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!push) return false;
    const addr = L.findfuncstart(push);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.USING_STRING }, 'MED');
}

function InsertMEDHook() {
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const d = new DataView(b.buffer, b.byteOffset, b.length);
    const lo = L.processStartAddress, hi = L.processStopAddress;
    for (let i = lo; i < hi - 4; i++) {
        if (i - base + 4 > b.length) break;
        if (d.getUint32(i - base, true) === 0x8175) { // cmp *, 8175
            for (let j = i, k = i + 0x100; j < k; j++) {
                if (j - base + 5 > b.length) break;
                if (b[j - base] === 0xe8) {
                    const t = (j + 5 + d.getUint32(j - base + 1, true)) >>> 0;
                    if (t > lo && t < hi) {
                        return L.NewHook({ address: t, offset: L.regoffset('eax'), type: L.CODEC_ANSI_BE }, 'MED');
                    }
                }
            }
        }
    }
    return false;
}

const E = L.engine({
    name: 'MBLMED',
    check: { FILE_ANY: ['*.mbl', '*.med'] },
    attach() {
        const b1 = L.CheckFile('*.mbl') && InsertMBLHook();
        const b2 = L.CheckFile('*.med') && (h1() || InsertMEDHook());
        return b1 || b2;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
