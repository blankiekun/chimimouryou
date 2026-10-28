// Tenco.js: LunaHook's Tenco engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Tenco.cpp and Tenco.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

/**
 *  jichi 4/1/2014: Insert AU hook
 *  Sample games:
 *  英雄戦姫: /HBN-8*4@4AD807
 *  英雄戦姫GOLD: /HB-8*4@4ADB50 (alternative)
 *
 *  /HBN-8*4@4AD807: ind 4, length_offset 1, off -0xc, type 0x408; the hook is on the
 *  `call` after `lea ebx,[esp+0x24]` (004ad807, "jichi: hook here").
 */
function InsertTencoHook() {
    const bytes = [
        0x6a, 0x00,                         // 004ad7f8  |> 6a 00          |push 0x0
        0x8d, 0x8f, 0xb0, 0x00, 0x00, 0x00, // 004ad7fa  |. 8d8f b0000000  |lea ecx,dword ptr ds:[edi+0xb0]
        0x83, 0xc8, 0xff,                   // 004ad800  |. 83c8 ff        |or eax,0xffffffff
        0x8d, 0x5c, 0x24, 0x24,             // 004ad803  |. 8d5c24 24      |lea ebx,dword ptr ss:[esp+0x24]
        0xe8,                               // 740cf6ff                 // 004ad807  |. e8 740cf6ff    |call ...     ; jichi: hook here
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    // reladdr = 0x4ad807;
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes.length - 1,
        index: 4,
        offset: L.regoffset('ecx'),
        type: L.NO_CONTEXT | L.DATA_INDIRECT,
    }, 'Tenco');
}

function LWScript() {
    const bytes = [
        0x33, 0xdb,
        0x53,
        0x8d, 0x87, ...XX4,
        0x50,
        0x55,
        0x57,
        0xe8];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.USING_STRING }, 'LWScript');
}

function LWScript2() {
    const bytes = [
        0x66, 0xC1, 0xE8, 0x08,
        0x3C, 0x81];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let off;
    if (L.u8(addr + 3) === 0x4C) off = L.stackoffset(2);
    else off = L.regoffset('ecx');
    let succ = L.NewHook({ address: addr, offset: off, type: L.CODEC_ANSI_BE }, 'LWScript2');
    const addrs = L.findxref_reverse(addr, addr - 0x10000, addr);
    for (let a of addrs) {
        a = L.findEnclosingAlignedFunction(a);
        if (!a) continue;
        succ = L.NewHook({ address: a, offset: L.stackoffset(5), type: L.CODEC_ANSI_BE }, 'LWScript2_xref') || succ;
    }
    return succ;
}

// https://vndb.org/r64724
function h() {
    const bytes = [
        0x83, 0x7e, 0x18, 0x10,
        0x8d, 0x7e, 0x04,
        0x72, 0x04,
        0x8b, 0x07,
        0xeb, 0x02,
        0x8b, 0xc7,
        0x80, 0x3c, 0x18, 0x3c,
        0x75, L.XX,
        0x43,
        0x3b, 0x5e, 0x14];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x100, true);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            // a2 points at a std::string: { _Buf / _Ptr (+4), _Size (+0x14), _Res (+0x18) } after a vtable-less header
            const a2 = context.stack[2];
            const v8 = a2 + 4;
            const v9 = L.u32(a2 + 24) < 0x10 ? v8 : L.u32(v8);
            buffer.from(v9, L.u32(a2 + 20));
            split.value = L.u32(context.eax);
        },
        filter_fun(buffer) {
            buffer.fromA(L.re.sub(buffer.strA(), '<.*?>'));
            L.StringFilterBetweenA(buffer, '(', ')');
            L.StringFilterA(buffer, '&'); // StringFilter(buffer, "&,", 1): length 1
            L.StringFilterA(buffer, '&'); // StringFilter(buffer, "&.", 1): length 1
        },
    }, 'Tenco');
}

const E = L.engine({
    name: 'Tenco',
    check: () => L.CheckFile('Check.mdx') || L.SearchResourceString('TENCO / MONOCHROMA Inc.'),
    files: ['Check.mdx'],
    attach() {
        const b3 = InsertTencoHook();
        const b1 = LWScript();
        const b2 = LWScript2();
        return b1 || b2 || b3 || h();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
