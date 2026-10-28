// CaramelBox.js: LunaHook's CaramelBox engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CaramelBox.cpp and CaramelBox.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function SpecialHookCaramelBox(context, hp, buffer, split) {
    const reg_ecx = context.offset(hp.offset); // *(DWORD *)(context->base + hp->offset)
    let ptr = reg_ecx;
    const text_buffer = [];
    while (L.u8(ptr)) {
        if (L.u8(ptr) === 0x28) { // Furigana format: (Kanji,Furi)
            ptr++;
            while (L.u8(ptr) !== 0x2c) // Copy Kanji
                text_buffer.push(L.u8(ptr++));
            while (L.u8(ptr) !== 0x29) // Skip Furi
                ptr++;
            ptr++;
        } else if (L.u8(ptr) === 0x5c) {
            ptr += 2;
        } else {
            text_buffer.push(L.u8(ptr));
            if (L.IsDBCSLeadByteEx(932, L.u8(ptr))) { // LeadByteTable[ptr[0]] == 2
                ptr++;
                text_buffer.push(L.u8(ptr));
            }
            ptr++;
        }
    }
    buffer.fromA(String.fromCharCode(...text_buffer));
    split.value = 0; // 8/3/2014 jichi: use return address as split
}

// jichi 10/1/2013: Change return type to bool
function InsertCaramelBoxHook() {
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const pb = (a) => (a >= base && a - base < b.length ? b[a - base] : 0);
    const pd = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
    let reg = -1;
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++) {
        if (pd(i) === 0x7ff3d) // cmp eax, 7ff
            reg = 0;
        else if (((pd(i) & 0xfffff8fc) >>> 0) === 0x07fff880) // cmp reg, 7ff
            reg = pb(i + 1) & 0x7;

        if (reg === -1)
            continue;

        let flag = 0;
        if (pb(i - 6) === 3) { // add reg, [ebp+$disp_32]
            if (pb(i - 5) === (0x85 | (reg << 3)))
                flag = 1;
        } else if (pb(i - 3) === 3) { // add reg, [ebp+$disp_8]
            if (pb(i - 2) === (0x45 | (reg << 3)))
                flag = 1;
        } else if (pb(i - 2) === 3) { // add reg, reg
            if (((pb(i - 1) >> 3) & 7) === reg)
                flag = 1;
        }
        reg = -1;
        if (flag) {
            for (let j = i, k = i - 0x100; j > k; j--) {
                if (((pd(j) & 0xffff00ff) >>> 0) === 0x1000b8) { // mov eax,10??
                    const hp = { address: (j & ~0xf) >>> 0, text_fun: SpecialHookCaramelBox, type: L.USING_STRING, offset: 0 };
                    for (i = (i & ~0xffff) >>> 0; i < L.processStopAddress - 4; i++)
                        if (pb(i) === 0xe8) {
                            i++;
                            if (((pd(i) + i + 4) >>> 0) === hp.address) {
                                i += 4;
                                if ((pd(i) & 0xffffff) === 0x04c483)
                                    hp.offset = L.stackoffset(1);
                                else
                                    hp.offset = L.regoffset('ecx');
                                break;
                            }
                        }

                    if (hp.offset === 0) {
                        return false;
                    }

                    return L.NewHook(hp, 'CaramelBox');
                }
            }
        }
    }
    return false;
}

const E = L.engine({
    name: 'CaramelBox',
    // jichi 8/10/2013: Since *.bin is common, move CaramelBox to the end
    check: () => {
        const str = L.processName_lower.slice(0, -3) + 'bin'; // the exe's name with its extension replaced by bin
        return L.CheckFileAny([str, 'trial.bin']);
    },
    certain: false,
    attach() { return InsertCaramelBoxHook(); },
});

const E2 = L.engine({
    name: 'CaramelBoxMilkAji',
    check: { FILE: 'SdActiRc.dll' },
    certain: false,
    attach() {
        // 雨芳恋歌
        // https://vndb.org/v6663
        const bytes = [
            0x33, 0xD2,
            0xB9, 0x8A, 0x02, 0x00, 0x00,
            0xF7, 0xF1,
            0x6B, 0xC0, 0x44,
            0x6B, 0xC0, 0x03];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr)
            return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr)
            return false;
        return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(1) }, 'CaramelBox');
    },
});

const E3 = L.engine({
    name: 'CaramelBox2',
    check: () => {
        if (!L.CheckFile('*.mpg'))
            return false;
        const copyright = 'OTOBOKU-CaramelBox\0'; // OTOBOKU-CaramelBox  //Software\Caramel-Box\OTOMEHABOKUNIKOISHITERU
        return 0 !== L.findBytes(L.aToBytes(copyright), L.processStartAddress, Math.min(L.processStopAddress, L.processStartAddress + 0x200000));
    },
    attach() {
        // https://vndb.org/r19777
        // Otoboku - Maidens Are Falling for Me! - Download Edition
        // Left out: LunaHook hooks the GDI functions and, from a trigger_fun on TextOutA / GetTextExtentPoint32A,
        // the enclosing function of the caller (USING_STRING | USING_SPLIT, arg2). trigger_fun is not supported;
        // returning false lets the automatic script fall back to the GDI hooks, as PcHooks::hookGDIFunctions does.
        return false;
    },
});

module.exports = [E, E2, E3];
if (!module.parent) L.run([E, E2, E3]);
