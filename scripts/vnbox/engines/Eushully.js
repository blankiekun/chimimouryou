// Eushully.js: LunaHook's Eushully engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Eushully.cpp and Eushully.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function InsertEushullyHook() {
    const addr0 = L.findLastCallerAddressAfterInt3(L.FindFunction('GetTextExtentPoint32A'), L.processStartAddress, L.processStopAddress);
    if (!addr0) {
        return false;
    }
    let lastCaller = 0,
        lastCall = 0;
    const fun = (caller, call) => {
        lastCaller = caller;
        lastCall = call;
        return true; // find last caller && call
    };
    L.iterCallerAddressAfterInt3(fun, L.FindFunction('GetTextExtentPoint32A'), L.processStartAddress, L.processStopAddress);
    if (!lastCaller)
        return false;

    let thisCaller = 0,
        thisCall = 0,
        prevCall = 0;
    const fun2 = (caller, call) => {
        if (((call - prevCall) >>> 0) === 133) { // 0x0046e1f8 - 0x0046e173 = 133
            thisCaller = caller;
            thisCall = call;
            return false; // stop iteration
        }
        prevCall = call;
        return true; // continue iteration
    };
    L.iterCallerAddressAfterInt3(fun2, L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStopAddress);
    // current stack: arg1_hdc = 4 * 1, arg2_lpString = 4 * 2, arg3_lc = 4 * 3, arg4_lpSize = 4 * 4
    const arg2_lpString = 4 * 2; // 0x8
    {
        const sig = 0x550010c2;
        const fun_offset = 3;
        for (let addr = lastCaller; addr < lastCall; addr++)
            if (L.u32(addr) === sig) {
                lastCaller = addr + fun_offset;
                break;
            }
    }
    const hp = {
        address: lastCaller,
        type: L.USING_STRING | L.FIXING_SPLIT, // merging all threads
        offset: arg2_lpString, // arg2 = 0x4 * 2
    };
    let succ = L.NewHook(hp, 'ARCGameEngine');
    if (thisCaller) {
        hp.address = thisCall;
        hp.offset = L.stackoffset(6);
        succ = L.NewHook(hp, 'ARCGameEngine_other') || succ;
    }
    return succ;
}

function TENMEI() {
    const sig = [
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x0f, 0x00, 0x00, 0x00,
        0xc6, 0x45, XX, 0x00,
        0xc6, 0x45, XX, 0x01,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x00, 0x00, 0x00, 0x00,
        0xc7, 0x45, XX, 0x0f, 0x00, 0x00, 0x00,
        0xc6, 0x45, XX, 0x00,
        0xc6, 0x45, XX, 0x03];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.USING_SPLIT | L.NO_CONTEXT, // 必须NO_CONTEXT否则被注音的字会被分开
        offset: L.stackoffset(5),
        split: L.stackoffset(1), // name 80000000 各种所有text 0
        filter_fun(buffer) {
            L.StringReplacerA(buffer, '\xf0\x41\xf0\x43', '\x81\x5c\x81\x5c');
            L.StringFilterA(buffer, '\xf0\x40');
            L.CharFilterA(buffer, '\n');
        },
    }, 'TENMEI');
}

function pchooks() {
    const hp = {
        address: L.FindFunction('GetStringTypeExW'),
        offset: L.stackoffset(3),
        type: L.USING_STRING | L.CODEC_UTF16,
        filter_fun(buffer) {
            let ws = buffer.strW();
            ws = ws.replace(//g, '—').replace(//g, '—').replace(//g, '…');
            buffer.fromW(ws);
        },
    };
    let succ = L.NewHook(hp, 'eushully');
    hp.address = L.FindFunction('GetTextExtentPoint32W');
    hp.offset = L.stackoffset(2);
    succ = L.NewHook(hp, 'eushully') || succ;
    L.hookGDIFunctions(L.FindFunction('GetTextExtentPoint32A'));
    return succ;
}

const E = L.engine({
    name: 'Eushully',
    check: { FILE: 'AGERC.DLL' }, // 6/1/2014 jichi: Eushully, AGE.EXE
    attach() {
        const a = InsertEushullyHook();
        const b = TENMEI();
        return (a || b) || pchooks();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
