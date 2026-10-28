// Bruns.js: LunaHook's Bruns engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Bruns.cpp and Bruns.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertBrunsHook() {
    let success = false;
    if (L.CheckFile('libscr.dll')) {
        const hp = { offset: L.stackoffset(1), type: L.CODEC_UTF16 };
        // ?push_back@?$basic_string@GU?$char_traits@G@std@@V?$allocator@G@2@@std@@QAEXG@Z
        const push_back = '?push_back@?$basic_string@GU?$char_traits@G@std@@V?$allocator@G@2@@std@@QAEXG@Z';
        if (L.CheckFile('msvcp90.dll')) hp.address = L.GetProcAddress(L.GetModuleHandle('msvcp90.dll'), push_back);
        else if (L.CheckFile('msvcp80.dll')) hp.address = L.GetProcAddress(L.GetModuleHandle('msvcp80.dll'), push_back);
        else if (L.CheckFile('msvcp100.dll')) hp.address = L.GetProcAddress(L.GetModuleHandle('msvcp100.dll'), push_back); // jichi 8/17/2013: MSVCRT 10.0 and 11.0
        else if (L.CheckFile('msvcp110.dll')) hp.address = L.GetProcAddress(L.GetModuleHandle('msvcp110.dll'), push_back);
        if (hp.address) {
            success = L.NewHook(hp, 'Bruns') || success;
        }
    }
    // jichi 12/21/2013: Keep both bruns hooks
    // The first one does not work for games like 「オーク・キングダマモン娘繁殖�豚人王～�anymore.
    {
        // i walks the exe image: ib/iw/id are the BYTE/WORD/DWORD at i (0 outside the image)
        const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
        const dv = new DataView(b.buffer, b.byteOffset, b.length);
        const ib = (a) => (a >= base && a - base < b.length ? b[a - base] : 0);
        const iw = (a) => (a >= base && a - base + 2 <= b.length ? dv.getUint16(a - base, true) : 0);
        const id = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
        let k = (L.processStopAddress - 4) >>> 0;
        for (let i = L.processStartAddress + 0x1000; i < k; i++) {
            if (id(i) !== 0xff) continue; // cmp reg,0xff
            i += 4;
            if (iw(i) !== 0x8f0f) continue; // jg
            i += 2;
            i = (i + id(i) + 4) >>> 0;
            for (let j = i + 0x40; i < j; i++) {
                if (ib(i) !== 0xe8) continue;
                i++;
                let t = (i + 4 + id(i)) >>> 0;
                if (t > L.processStartAddress && t < L.processStopAddress) {
                    i = t;
                    for (j = i + 0x80; i < j; i++) {
                        if (ib(i) !== 0xe8) continue;
                        i++;
                        t = (i + 4 + id(i)) >>> 0;
                        if (t > L.processStartAddress && t < L.processStopAddress) {
                            return L.NewHook({ address: t, offset: L.stackoffset(1), type: L.CODEC_UTF16 | L.DATA_INDIRECT }, 'Bruns2');
                        }
                    }
                    k = i; // Terminate outer loop.
                    break; // Terminate inner loop.
                }
            }
        }
    }
    return success;
}

const E = L.engine({
    name: 'Bruns',
    certain: false,
    check: () => L.CheckFile('args.txt') || (L.processName_lower.includes('bruns') || L.CheckFile('bruns.exe')),
    attach() { return InsertBrunsHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
