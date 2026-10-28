// GROOVER.js: LunaHook's GROOVER engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GROOVER.cpp and GROOVER.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags.
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function GreenGreen3_textonly() {
    // https://vndb.org/v214
    // グリーングリーン3 ハローグッバイ
    // sprintf(v15, "%s\\p\\l", v11);
    const pl = L.aToBytes('%s\\p\\l');
    let addr = L.findBytes(pl, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findBytes([0xe8], addr, addr + 0x10);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING | L.NO_CONTEXT }, 'GROOVER');
}
function GreenGreen3_all() {
    const bytes = [
        0x8a, 0x14, 0x30,
        0x03, 0xc6,
        0x33, 0xc9,
        0x80, 0xfa, 0x5c,
        0x75, XX,
        0x8a, 0x50, 0x01,
        0x80, 0xfa, 0x6c,
        0x74, XX,
        0x80, 0xfa, 0x70,
        0x74, XX,
        0x80, 0xfa, 0x77,
        0x75, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            if (context.esi) return;
            buffer.fromCharPtr(context.eax);
        },
        filter_fun(buffer) {
            L.StringFilterA(buffer, '\\p\\l');
        },
    }, 'GROOVER');
}
function GreenGreen3() {
    return GreenGreen3_all() && GreenGreen3_textonly();
}
function GreenGreen2() {
    // https://vndb.org/v213
    // グリーングリーン2 恋のスペシャルサマー
    const psnrGetString = L.GetProcAddress(L.GetModuleHandle('HdSnr3'), 'snrGetString');
    if (!psnrGetString) return false;
    // snrGetString: qmemcpy(a3, sub_10001E10(a1, a2), v4), the source in eax
    const bytes = [
        0x8b, 0xcb,
        0x8b, 0xf0,
        0x8b, 0xc1,
        0x8b, 0xfd,
        0xc1, 0xe9, 0x02,
        0xf3, 0xa5];
    const addr = L.findBytes(bytes, psnrGetString, psnrGetString + 0x100);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.CODEC_UTF16,
        text_fun(context, hp, buffer, split) {
            if (L.all_ascii(L.readA(context.eax))) return;
            let ws = L.StringToWideString(L.readA(context.eax), 932);
            split.value = ws.endsWith('\\p\\l') ? 1 : 0;
            if (split.value) ws = ws.substr(0, ws.length - 4);
            let result = '';
            for (let i = 0; i < ws.length; i++) {
                if (L.katakanaMap.has(ws[i])) {
                    let wc = L.katakanaMap.get(ws[i]).charCodeAt(0);
                    if (0xff9e === ws.charCodeAt(i + 1)) {
                        wc += 1;
                        i += 1;
                    } else if (0xff9f === ws.charCodeAt(i + 1)) {
                        wc += 2;
                        i += 1;
                    }
                    result += String.fromCharCode(wc);
                } else result += ws[i];
            }
            buffer.fromW(result);
        },
    }, 'GROOVER');
}

const E = L.engine({
    name: 'GROOVER',
    check: () => L.CheckFileAll(['Data/GRP.ARC', 'Data/SCR.ARC', 'Data/SND.ARC']) && L.SearchResourceString('GROOVER'),
    attach() {
        if (L.GetModuleHandle('HdSnr3.dll') && L.GetModuleHandle('RoFAS.dll') && L.GetModuleHandle('RoSnd.dll')) return GreenGreen2();
        return GreenGreen3();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
