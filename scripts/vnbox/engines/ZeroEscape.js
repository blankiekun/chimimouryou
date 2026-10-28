// ZeroEscape.js: LunaHook's ZeroEscape engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ZeroEscape.cpp and ZeroEscape.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

function ze2() {
    const aDS = L.wToBytes('[%d] %s\0');
    let addr = L.findBytes(aDS, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findPushAddress(addr, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x80);
    if (!addr) return false;
    let i = 0; // static int i
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.CODEC_UTF8 | L.FULL_STRING,
        filter_fun(buffer) {
            if (i++ % 2) return buffer.clear();
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\[.*?\]`);
            s = L.re.sub(s, String.raw`<\w>`);
            s = L.re.sub(s, String.raw`\n`);
            buffer.fromA(s);
        },
    }, 'ZeroEscape');
}

function ze1() {
    // sprintf
    const sig = [
        0x55, 0x8b, 0xec,
        0x83, 0xec, 0x20,
        0x53, 0x57,
        0x33, 0xdb,
        0x8d, 0x7d, 0xe4,
        0x6a, 0x07,
        0x33, 0xc0,
        0x89, 0x5d, 0xe0,
        0x59,
        0xf3, 0xab,
        0x39, 0x45, 0x0c,
        0x75, 0x15,
        0xe8, ...XX4,
        0xc7, 0x00, 0x16, 0x00, 0x00, 0x00,
        0xe8, ...XX4,
        0x83, 0xc8, 0xff,
        0xeb, L.XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(3),
        type: L.USING_STRING | L.FULL_STRING,
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\x87\x53[a-z0-9]*`);
            s = L.re.sub(s, String.raw`\x81\xa5`);
            buffer.fromA(s);
        },
    }, 'ZeroEscape');
}

// Zero Escape: The Nonary Games
// https://store.steampowered.com/app/477740/Zero_Escape_The_Nonary_Games/
const E = L.engine({
    name: 'ZeroEscape',
    check: { FILE: 'ze*_data*.bin' },
    attach() { return ze2() || ze1(); },
});

module.exports = E;
if (!module.parent) L.run(E);
