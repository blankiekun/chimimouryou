// Bootup.js: LunaHook's Bootup engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Bootup.cpp and Bootup.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// jichi 5/22/2015: Insert Bootup hook (see Bootup.cpp for the sample games and the disassembly of
// the TextOut callers). Bootup.dat exists in the game folder; lstrlenW finds text repeating once;
// there is only one TextOut (W for new games, A for old). Full text is in arg1, shifted one by
// one; the character to paint is also in arg3.
function InsertBootupGDIHook() {
    let widechar = true;
    let addr = L.findCallerAddressAfterInt3(L.FindFunction('TextOutW'), L.processStartAddress, L.processStopAddress);
    if (!addr) {
        addr = L.findCallerAddressAfterInt3(L.FindFunction('TextOutA'), L.processStartAddress, L.processStopAddress);
        widechar = false;
    }
    if (!addr) {
        return false;
    }

    const hp = {};
    hp.address = addr;
    hp.type = L.USING_SPLIT | L.NO_CONTEXT | L.USING_CHAR; // use NO_CONTEXT to get rid of floating reladdr
    hp.type |= widechar ? L.CODEC_UTF16 : L.CODEC_ANSI_BE; // use context as split is sufficient, but will produce floating split
    const check = [
        0x83, 0xec, 0x14,
        0x53,
        0x56,
        0x8b, 0xf0,
        0x8b, 0x5e, XX,
        0x66, 0x39, 0x0b,
        0x74, XX];
    if (L.MatchPattern(addr, check)) {
        // Daylight - 朝に光の冠を
        hp.offset = L.regoffset('ecx');
        hp.split = L.stackoffset(2);
        hp.type |= L.SPLIT_INDIRECT;
        hp.filter_fun = (buffer) => { L.StringFilterA(buffer, '\x81\x40'); };
    } else {
        hp.offset = L.stackoffset(2); // arg2, character in arg2, could be modified by hook
        if (widechar)
            hp.split = L.regoffset('edx');
        else
            hp.split = L.stackoffset(1);
        hp.text_fun = (context, hp) => {
            const arg2 = context.stack[2];
            if ((arg2 & 0xffff0000)) { // if arg2 high bits are there, this is new Bootup game
                hp.type |= L.DATA_INDIRECT;
                hp.offset = L.stackoffset(3);
                hp.split = L.regoffset('ebx');
            }
            hp.text_fun = null;
        };
    }

    return L.NewHook(hp, widechar ? 'BootupW' : 'BootupA');
}

function InsertBootupLstrHook() { // for character name
    const widechar = true;
    let addr = L.findLastCallerAddressAfterInt3(L.FindFunction('GetCharABCWidthsW'), L.processStartAddress, L.processStopAddress);
    if (!addr) {
        // Do not hook to lstrlenA, which causes text extraction to stop
        // (the GetCharABCWidthsA / lstrlenA variant stays commented out in LunaHook)
    }
    if (!addr) {
        return false;
    }
    addr = L.findCallAddress(L.FindFunction(widechar ? 'lstrlenW' : 'lstrlenA'),
        L.processStartAddress, L.processStopAddress,
        addr - L.processStartAddress); // no range
    if (!addr) {
        return false;
    }

    return L.NewHook({
        address: addr,
        type: widechar ? (L.USING_STRING | L.CODEC_UTF16) : L.USING_STRING,
    }, widechar ? 'BootupLstrW' : 'BootupLstrA');
}

function InsertBootupHook() {
    const ret = InsertBootupGDIHook();
    InsertBootupLstrHook();
    return ret;
}

const E = L.engine({
    name: 'Bootup',
    check: { FILE: 'Bootup.dat' },
    certain: false,
    attach() { return InsertBootupHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
