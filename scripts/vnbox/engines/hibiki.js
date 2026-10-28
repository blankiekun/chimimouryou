// hibiki.js: LunaHook's hibiki engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/hibiki.cpp and hibiki.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

function hibikihook() {
    // ＬＯＶＥＬＹ×Ｃ∧ＴＩＯＮ
    // cmp edi, 20h / jz ... / cmp edi, 3000h / jz ...
    const bytes = [
        0x83, 0xff, 0x20,
        0x0f, 0x84, ...XX4,
        0x81, 0xff, 0x00, 0x30, 0x00, 0x00,
        0x0f, 0x84, ...XX4];
    let succ = false;
    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        succ = L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.CODEC_UTF16 | L.NO_CONTEXT }, 'hibiki_extra') || succ;
    }
    return succ;
}
let prevText = '';
function YaneSDKFilter(buffer) {
    let s = buffer.strW();
    if (prevText === s) return buffer.clear();
    prevText = s;

    s = L.strReplace(s, '[r]', ' ');
    s = L.strReplace(s, '[np]');

    // [桜木'さくらぎ]
    s = L.re.sub(s, String.raw`\[(.*?)'(.*?)\]`, '$1');
    s = L.strReplace(s, '[');
    s = L.strReplace(s, ']');
    buffer.fromW(s);
}
function InsertYaneSDKHook() {
    // https://vndb.org/v21734 v21455 v20406
    const bytes = [
        0x83, 0xF9, 0x08,      // cmp ecx,08         << hook here
        0x8D, 0x45, 0x0C,      // lea eax,[ebp+0C]
        0x8D, 0x4D, 0xBC,      // lea ecx,[ebp-44]
        0x0F, 0x43, 0xC2,      // cmovae eax,edx
        0x0F, 0xB7, 0x04, 0x70 // movzx eax,word ptr [eax+esi*2]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), filter_fun: YaneSDKFilter, type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'YaneSDK');
}

const E = L.engine({
    name: 'hibiki',
    check: { FILE: 'arc/*.dat' },
    certain: false,
    attach() { return hibikihook() || InsertYaneSDKHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
