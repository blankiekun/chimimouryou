// TACTICS.js: LunaHook's TACTICS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TACTICS.cpp and TACTICS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// 鈴がうたう日
// https://vndb.org/v8528
// TACTICSattach_function1 is left out: its hook reads a fixed global text pointer (DIRECT_READ, not
// supported). Its signature search is kept below so the engine still tells the games apart.
function TACTICSattach_function1() {
    const sig = [
        0x0f, 0xbf, 0x05, ...XX4,
        0X33, 0XD2,
        0X8A, 0x98, ...XX4,
        0x80, 0xe3, 0xff,
        0x8a, 0x80, ...XX4,
        0x81, 0xe3, 0xff, 0x00, 0x00, 0x00,
        0x24, 0xff,
        0xc1, 0xe3, 0x08,
        0x8a, 0xd0,
        0x03, 0xda,
        0x66, 0x83, 0x05, ...XX4, 0x02,
        0xeb, 0x15,
        0x0f, 0xbf, 0x0d, ...XX4,
        0x0f, 0xbe, 0x99, ...XX4,
        0x66, 0xff, 0x05, ...XX4];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = addr + 7 + 2 + 6 + 3 + 2;
    return L.NewHook({
        address: L.u32(addr),
        type: L.USING_STRING | L.DIRECT_READ, // refused by NewHook with a console note
        filter_fun(buffer) {
            L.CharFilterA(buffer, '\x01');
            L.CharFilterA(buffer, '\x02');
            L.CharFilterA(buffer, '\x03');
            L.CharFilterA(buffer, '\x04');
            L.CharFilterA(buffer, '\x05');
            L.CharFilterA(buffer, '\x11');
        },
    }, 'TACTICS_R');
}

function TACTICSattach_function2() {
    const sig = [
        0x2d, 0x40, 0x81, 0x00, 0x00,
        0x89, 0x83, XX, 0x00, 0x00, 0x00,
        0x3d, 0x57, 0x02, 0x00, 0x00,
        0x0f, 0x82, ...XX4,
        0xbf, 0x57, 0x02, 0x00, 0x00];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    let idx = 0; // static int idx
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR | L.CODEC_ANSI_BE,
        offset: L.regoffset('eax'),
        filter_fun(buffer) {
            if ((idx++) % 2) buffer.clear();
        },
    }, 'TACTICS_H');
}

// https://vndb.org/v2274
//[010119][Tactics] Cheerio! ～ちぇりお～ (bin+cue)
function h3() {
    /*
    if ( a5 != 33088 )
    {
      v6 = a5 - 33088;
      if ( a5 - 33088 < 0 || v6 > 597 )
      {
        v6 = 598;
        sub_417F5C(a1, a5, 598);
      }
    */
    const sig = [
        0x3d, 0x40, 0x81, 0x00, 0x00,
        0x0f, 0x84, ...XX4,
        0x8b, 0xf0,
        0x81, 0xee, 0x40, 0x81, 0x00, 0x00,
        0x85, 0xf6,
        0x7c, 0x08,
        0x81, 0xfe, 0x55, 0x02, 0x00, 0x00,
        0x7e, XX,
        0xbe, 0x56, 0x02, 0x00, 0x00];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x20); // v1.0不对齐
    if (!addr) return false;
    let idx = 0; // static int idx
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR | L.CODEC_ANSI_BE | L.NO_CONTEXT,
        offset: L.stackoffset(5),
        filter_fun(buffer) {
            if ((idx++) % 2) buffer.clear();
        },
    }, 'TACTICS_2');
}

const E = L.engine({
    name: 'TACTICS',
    check: () => L.SearchResourceString('ﾀｸﾃｨｸｽ') || L.SearchResourceString('Tactics'),
    attach() {
        const a = TACTICSattach_function1();
        const b = TACTICSattach_function2(); // `|`: both run
        return (a || b) || h3();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
