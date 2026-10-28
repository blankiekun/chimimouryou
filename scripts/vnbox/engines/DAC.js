// DAC.js: LunaHook's DAC engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/DAC.cpp and DAC.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function DACattach_function() {
    // https://vndb.org/v11673
    // もみえろCureTouch ～イカすマッサージ天国～
    const bytes = [
        0x80, 0x3f, 0x60,
        0x75, XX,
        0x80, 0x7f, 0x01, 0x23,
        0x75, XX,
        0x6a, 0x60,
        0x6a, 0x60,
        0x57,
        0xe8, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const mp = new Map(); // static std::map<DWORD, std::string> mp
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            if (!mp.has(context.retaddr)) mp.set(context.retaddr, '');
            const thisthread = mp.get(context.retaddr);
            let s = L.readA(context.stack[2]);
            s = L.strSplit(s, '\n')[0];
            if (thisthread.endsWith(s)) {
                // same line again
            } else {
                mp.set(context.retaddr, s);
                s = L.strReplace(s, '`#`{$$lines}');
                s = L.strReplace(s, '\n');
                s = L.strReplace(s, '\r');
                buffer.fromA(s);
            }
        },
    }, 'DAC');
}

function DACattach_function2() {
    // 少女達のさえずり
    // https://vndb.org/v5378
    const bytes = [
        0x66, 0x81, XX, 0x84, 0xaa,
        0x74, 0x07,
        0x66, 0x81, XX, 0x84, 0x9f,
        0x75, 0x0b];
    const addrX = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addrX) return false;
    let addr = L.findfuncstart(addrX);
    if (!addr) {
        //[120831][Exception] 白神子～しろみこ～ 初回限定版
        const start2 = [0xcc, 0x83, 0xec, XX];
        addr = L.reverseFindBytes(start2, addrX - 0x100, addrX);
        if (addr) addr += 1;
    }
    if (!addr) return false;
    const mp = new Map(); // static std::map<DWORD, std::string> mp
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            if (!mp.has(context.retaddr)) mp.set(context.retaddr, '');
            const thisthread = mp.get(context.retaddr);
            const s = L.readA(context.stack[6]);
            if (s.startsWith(thisthread)) {
                buffer.fromA(s.substr(thisthread.length));
            } else {
                buffer.fromA(s);
            }
            mp.set(context.retaddr, s);
        },
    }, 'DAC2');
}

const E = L.engine({
    name: 'DAC',
    check: () => L.CheckFile('*.dpk') && L.SearchResourceString('DAC'),
    attach() { return DACattach_function() || DACattach_function2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
