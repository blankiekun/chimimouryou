// UnisonShift.js: LunaHook's UnisonShift engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/UnisonShift.cpp and UnisonShift.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertUnisonShiftHook() {
    const bytes = [
        0x83, 0xec, 0x14,
        0x8b, 0x44, 0x24, 0x10,
        0x53,
        0x55,
        0x8b, 0x6c, 0x24, 0x20,
    ];
    const addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr1 === 0) return false;
    return L.NewHook({ address: addr1, offset: L.stackoffset(3) }, 'UnisonShift');
}

function InsertUnisonShift2Hook() {
    const bytes = [
        // 80 FB A0                      cmp     bl, 0A0h
        0x80, 0xfb, 0xa0];
    let addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr1 === 0) return false;
    const start = [0x83, 0xEC, 0x08];
    addr1 = L.reverseFindBytes(start, addr1 - 0x100, addr1);
    if (addr1 === 0) return false;
    return L.NewHook({ address: addr1, offset: L.regoffset('eax'), type: L.DATA_INDIRECT, index: 0 }, 'UnisonShift2');
}

// Left out: InsertUnisonShift3Hook, whose only hook reads a global text address (DIRECT_READ, not
// supported). It searched `80 F9 XX` and followed a `mov eax, imm32` back to the text pointer.
function InsertUnisonShift3Hook() {
    return false;
}

// https://vndb.org/v7123
// 凌辱人妻温泉
function _056() {
    const bytes = [
        0x83, 0xc4, 0x0c,
        0x83, 0xc1, 0x1e,
        0x80, 0xfb, 0x81,
        0x89, XX, ...XX4,
        0x0f, 0x85, ...XX4,
        0x8a, 0x44, 0x24, 0x08,
        0x3c, 0x76,
        0x74, 0x08,
        0x3c, 0x78,
        0x0f, 0x85, ...XX4];
    let addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr1 === 0) return false;
    addr1 = L.findEnclosingAlignedFunction(addr1);
    if (addr1 === 0) return false;
    let last = ''; // static std::string last
    return L.NewHook({
        address: addr1,
        offset: L.regoffset('edx'),
        type: L.USING_STRING,
        filter_fun(buffer) {
            const xx = buffer.strA();
            if (xx === last) return buffer.clear();
            last = xx;
        },
    }, '_056');
}

function h1() {
    // 胸キュン！はぁとde恋シ・テ・ル～お兄ちゃんもっと大好き～
    // https://vndb.org/v4263
    const bytes = [
        0x8b, 0x15, ...XX4,
        0x56,
        0xbe, ...XX4,
        0x8b, 0x0c, 0x95, ...XX4,
        0x8a, 0x01,
        0x84, 0xc0,
        0x74, XX,
        0x2b, 0xce,
        0x88, 0x06,
        0x8a, 0x44, 0x31, 0x01,
        0x46,
        0x84, 0xc0,
        0x75, XX];
    const addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr1) return false;
    return L.NewHook({
        address: addr1 + 6 + 1 + 5 + 7,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING | L.FULL_STRING,
        filter_fun(buffer) {
            let s = buffer.strAW();
            s = L.re.sub(s, '#');
            buffer.fromWA(s);
        },
    }, 'UnisonShift4');
}

const E = L.engine({
    name: 'UnisonShift',
    check: { FILE: '*.dat' },
    certain: false,
    attach() { return InsertUnisonShiftHook(); },
});

const E2 = L.engine({
    name: 'UnisonShift2',
    check: { FILE_ALL: ['PIC.*', 'TP.*', 'GR.*', 'BGM.*'] },
    attach() {
        const b1 = InsertUnisonShift2Hook();
        const b2 = InsertUnisonShift3Hook();
        const __ = _056();
        return b1 || b2 || __ || h1();
    },
});

module.exports = [E, E2];
if (!module.parent) L.run(E);
