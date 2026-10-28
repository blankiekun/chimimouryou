// HorkEye.js: LunaHook's HorkEye engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/HorkEye.cpp and HorkEye.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: embed_fun/hookafter (translation written back), EMBED flags, the spDefault assignment.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// HorkEye, http://horkeye.com (jichi 10/20/2014). The hook at `mov cl, byte ptr ds:[edx+ebx]` has ebx = the text.
// Skip text between "," and "\x81\x7a" (a sjis bracket), and remove [n]
// ex: 【夏偾,S005_B_0002】「バーッ�ク
function HorkEyeFilter(buffer) {
    let s = buffer.strA();
    // Remove text between , and ]
    const start = s.indexOf(',');
    if (start >= 0) {
        const stop = s.indexOf('\x81\x7a', start);
        if (stop >= 0) s = s.slice(0, start) + s.slice(stop);
    }
    // Remove [n]
    s = L.strReplace(s, '[n]');
    buffer.fromA(s);
}

// hookBefore<offset>: stack[offset] is the text; a negative offset is a register slot (-4 edx, -5 ebx, -2 eax)
function hookBefore(offset) {
    return (context, hp, buffer, split) => {
        let str = L.readA(context.offset(4 * offset));
        const stop = str.indexOf('\x81\x7a'); // = u'】'.encode('sjis')
        if (stop >= 0) str = str.slice(stop + 2);
        buffer.fromA(str);
    };
}

function InsertHorkEyeHook() {
    const bytes = [
        0x89, 0x6c, 0x24, 0x24, // 013cdb01   896c24 24        mov dword ptr ss:[esp+0x24],ebp
        0x89, 0x74, 0x24, 0x0c, // 013cdb05   897424 0c        mov dword ptr ss:[esp+0xc],esi
        0x89, 0x4c, 0x24, 0x18, // 013cdb09   894c24 18        mov dword ptr ss:[esp+0x18],ecx
        0x8a, 0x0c, 0x1a        // 013cdb0d   8a0c1a           mov cl,byte ptr ds:[edx+ebx]        jichi: here
    ];
    const addr_offset = bytes.length - 3; // 8a0c1a
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr) {
        return L.NewHook({
            address: addr + addr_offset,
            offset: L.regoffset('ebx'),
            type: L.USING_STRING | L.NO_CONTEXT | L.FIXING_SPLIT,
            text_fun: hookBefore(-4 - 1),
            filter_fun: HorkEyeFilter,
            lineSeparator: '[n]',
        }, 'HorkEye');
    }

    // spDefault.pattern = {0xcc, 0xcc, 0xcc, XX, 0xec}, offset 3: not needed by VNBox's NewHook

    const bytes2 = [
        0x83, 0xec, XX,  // sub esp,??
        0xa1, ...XX4,    // mov eax,??
        0x8b, 0x0d, ...XX4, // mov ecx,??
        0x03, 0xc0       // add eax,eax
    ];
    for (const a of L.findBytesAll(bytes2, L.processStartAddress, L.processStopAddress)) {
        return L.NewHook({ address: a, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT, text_fun: hookBefore(1) }, 'HorkEye2');
    }
    return false;
}

function InsertHorkEye3Hook() {
    const bytes2 = [
        0x55,
        0x8d, 0xac, 0x24, ...XX4,
        0x81, 0xec, ...XX4,
        0x6a, 0xff,
        0x68, ...XX4,
        0x64, 0xa1, 0x00, 0x00, 0x00, 0x00,
        0x50,
        0x83, 0xec, 0x38, // 必须是0x38，不能是XX，否则有重的。
    ];
    const addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT, text_fun: hookBefore(1) }, 'HorkEye3');
}

function InsertHorkEye4Hook() {
    // 辻堂さんのバージンロード
    // 辻堂さんの純愛ロード
    const bytes2 = [
        0xf7, 0xd8,
        0x1b, 0xc0,
        0x83, 0xc0, 0x02];
    let addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const bytebetter = [
        0x8b, XX, XX, XX,
        0xa1, ...XX4,
        0x83, 0xc4, XX,
        0x8b, XX];
    const addr1 = L.findBytes(bytebetter, addr - 0x100, addr);
    if (addr1) addr = addr1;
    else addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.USING_STRING | L.NO_CONTEXT, text_fun: hookBefore(-1 - 1) }, 'HorkEye4');
}

function InsertHorkEye6Hook() {
    // みなとカーニバルFD
    const bytes2 = [
        0x83, 0xc2, 0x6c,
        0x52,
        0xe8];
    let addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const start = [0x6A, 0xFF];
    addr = L.reverseFindBytes(start, addr - 0x1000, addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.CODEC_ANSI_BE }, 'HorkEye6');
}

const E = L.engine({
    name: 'HorkEye',
    check: { RESOURCE_STR: 'HorkEye' },
    attach() {
        const b1 = InsertHorkEyeHook();
        const b2 = InsertHorkEye3Hook();
        const b3 = InsertHorkEye4Hook();
        const b4 = InsertHorkEye6Hook();
        return b1 || b2 || b3 || b4;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
