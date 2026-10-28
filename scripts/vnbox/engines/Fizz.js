// Fizz.js: LunaHook's Fizz engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Fizz.cpp and Fizz.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function Fizzattach_function1() {
    // char __thiscall sub_59AA90(char *this, int a2, int a3, int a4, int a5, int a6, int a7, int a8, char a9)
    // HB8@59AA90
    // https://vndb.org/v1380
    // さくらテイル
    const bytes = [
        0x55, 0x8b, 0xec,
        0x6a, 0xff,
        0x68, ...XX4,
        0x64, 0xa1, 0, 0, 0, 0,
        0x50,
        0x81, 0xec, ...XX2, 0, 0,
        0xa1, ...XX4,
        0x33, 0xc5,
        0x89, 0x45, 0xf0,
        0x50,
        0x8d, 0x45, 0xf4,
        0x64, 0xa3, 0, 0, 0, 0,
        0x89, 0x4d, XX,
        0xc7, 0x45, XX, 0, 0, 0, 0,
        0xc7, 0x45, XX, 0, 0, 0, 0,
        0x8d, 0x4d, XX,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_CHAR }, 'Fizz');
}

function gsd() {
    //[110128][アトリエさくら]清純なカラダは、アイツの腕の中で男を知っていく
    // https://vndb.org/v5688
    // size_t __cdecl strlen(const char *Str)
    const bytes = [
        0xBA, 0xFF, 0xFE, 0xFE, 0x7E,
        0x03, 0xD0,
        0x83, 0xF0, 0xFF,
        0x33, 0xC2,
        0x83, 0xC1, 0x04,
        0xA9, 0x00, 0x01, 0x01, 0x81,
        0x74, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig = [0x8b, 0x4c, 0x24, 0x04];
    addr = L.reverseFindBytes(sig, addr - 0x40, addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(1), filter_fun: L.all_ascii_Filter }, 'gsd');
}

let typex = 0; // set by the check, read by attach

const E = L.engine({
    name: 'Fizz',
    check: () => {
        if (!L.CheckFileAll(['data.gsp', 'Image*.gsp', 'bgm*.gsp', 'se.gsp'])) return false;
        typex = L.CheckFile('voice/*.gsp') ? 1 : 2;
        return true;
    },
    attach() {
        if (typex === 1) return Fizzattach_function1();
        if (typex === 2) return gsd();
        return false;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
