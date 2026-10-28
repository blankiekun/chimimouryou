// Mink.js: LunaHook's Mink engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Mink.cpp and Mink.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font of Mink3; the #if 0 InsertMinkDynamicHook.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** 12/23/2014 jichi: Mink games (not sure the engine name)
 *  Sample game:
 *  - [130111] [Mink EGO] お持ち帰りにはぜったい言えないひみつなこと -- /HB-4*0:64@45164A
 *  - [141219] [Mink] しすたぁ・すきーむ3
 *
 *  /HB-4*0:64@45164A
 *  - addr: 0x45164a
 *  - length_offset: 1
 *  - split: 0x64
 *  - off: 0xfffffff8 = -8
 *  - type: 0x18
 */
const ispunct = (c) => (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e);

function SpecialHookMink(context, hp, buffer, split) {
    // DWORD addr = *(DWORD *)(esp_base + hp->offset); // default value
    const addr = context.eax;
    if (!L.isAddressReadable(addr)) return; // IthGetMemoryRange(addr, 0, 0)
    const ch = L.u32(addr);
    const size = L.IsShiftjisLeadByte(ch & 0xff) ? 2 : 1; // LeadByteTable[ch & 0xff]
    if (size === 1 && ispunct(ch & 0xff)) // skip ascii punctuations, since garbage is like ":text:"
        return;
    if (!L.IsShiftjisLeadByte(ch & 0xff)) // IsShiftjisLeadByte takes a BYTE
        return;
    // Issue: still have lots of garbage
    split.value = context.stack[25];
    buffer.from_t(ch, size);
}

function InsertMinkHook() {
    const bytes = [
        0x38, 0x18,             // 00451648   3818             cmp byte ptr ds:[eax],bl
        0x75, 0x14,             // 0045164a   75 14            jnz short .00451660         ; jichi: hook here
        0x38, 0x5d, 0xf4,       // 0045164c   385d f4          cmp byte ptr ss:[ebp-0xc],bl
        0x74, 0x07,             // 0045164f   74 07            je short .00451658
        0x8b, 0x45, 0xf0,       // 00451651   8b45 f0          mov eax,dword ptr ss:[ebp-0x10]
        0x83, 0x60, 0x70, 0xfd, // 00451654   8360 70 fd       and dword ptr ds:[eax+0x70],0xfffffffd
        0x8b, 0x45, 0x08,       // 00451658   8b45 08          mov eax,dword ptr ss:[ebp+0x8]
    ];
    const addr_offset = 2;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('eax'), // -8
        split: 0x64,
        type: L.USING_SPLIT | L.DATA_INDIRECT | L.USING_CHAR, // 0x18
        text_fun: SpecialHookMink,
    }, 'Mink');
}

function attachMink2() { // Mink2::attach_function
    const pattern = [
        // 破談屋
        // https://vndb.org/v2719
        0xF7, 0xC7, 0x03, 0x00, 0x00, 0x00,
        0x75, XX,
        0xC1, 0xE9, 0x02,
        0x83, 0xE2, 0x03,
        0x83, 0xF9, 0x08,
        0x72, XX];
    let found = false;
    for (let addr of L.SearchMemory(pattern, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr, 0x100);
        if (!addr) return false;
        found = L.NewHook({ address: addr, offset: L.stackoffset(2), length_offset: 3, type: L.USING_STRING }, 'Mink') || found;
    }
    return found;
}

function MINK2() {
    // 催眠学級
    const pattern = [
        0X80, 0XFB, 0X81,
        ...XX4,
        ...XX4,
        ...XX4,
        0x72, XX,
        0X80, 0XFB, 0X9F,
        0X76, XX,
        0X8A, 0XCb,
        0X80, 0xc1, 0X20,
        0x80, 0xf9, 0x1c,
        0X77, XX,
        0X0F, 0XB6, XX,
        0XC1, 0XE3, 0X08,
        0X03, XX,
        0x83, 0xc0, 0x01,
        0X89, XX, 0X24, XX,
        0X89, XX, 0X24, XX,
        0XEB, 0X08];
    let addr = L.findBytes(pattern, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(4),
        split: L.stackoffset(8),
        type: L.USING_STRING | L.USING_SPLIT | L.FULL_STRING,
    }, 'Mink2');
}

function MdePink() {
    // (18禁ゲーム) [100903][minkm_0012][M de Pink] しすたー・すきーむ2 アニメーション追加版 DL版
    // 催眠学級 HD https://vndb.org/r30973
    const pattern = [
        0X80, 0XFB, 0X81,
        0X72, 0X05,
        0X80, 0XFB, 0X9F,
        0X76, 0X08,
        0X8A, 0XC3,
        0X04, 0X20,
        0X3C, 0X1C,
        0X77, 0X13,
        0X0F, 0XB6, XX,
        0XC1, 0XE3, 0X08,
        0X03, XX,
        XX,
        0X89, XX, 0X24, 0X14,
        0X89, XX, 0X24, XX,
        0XEB, 0X08];
    let addr = L.findBytes(pattern, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            split.value = context.stack[5];
            if (split.value === 0xff000000 || split.value === 0xffFFFFF || split.value === 0x7f0f3f0f || split.value === 0x1f000000) split.value = 2;
            else if (split.value === 0xff0f0f0f || split.value === 0xff7f0f0f) split.value = 1;
            else return;
            buffer.fromCharPtr(context.edx);
        },
    }, 'MdePink');
}

function attachMink3() { // Mink3::attach_function
    const pattern = [
        // 夜勤病棟 復刻版+
        0xff, 0x15, ...XX4,
        0x33, 0xdb,
        0x89, 0x44, 0x24, XX,
        0x85, 0xc0,
        0x7e, XX,
        0x8a, 0x07,
        0x8d, 0x4c, 0x24, 0x10,
        0x50,
        0xe8, ...XX4,
        0x83, 0xf8, 0x02,
        0x75, 0x08,
        0x03, 0xd8,
        0x03, 0xf8,
        0x03, 0xf0,
        0xeb, XX,
        0x57,
        0x8b, 0xcd,
        0xe8, ...XX4,
        0x25, 0xff, 0x00, 0x00, 0x00,
        0x83, 0xe8, 0x00];
    let addr = L.findBytes(pattern, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    if (!addr) return false;
    L.hookGDIFunctions(L.FindFunction('TextOutA'));
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING, lineSeparator: '\\n' }, 'Mink');
}

const E = L.engine({
    name: 'Mink',
    check: { FILE_ANY: ['*.at2', '*.atm'] }, // Mink, sample files: voice.at2, voice.det, voice.nme
    attach() { return MdePink() || MINK2() || InsertMinkHook(); },
});

const E2 = L.engine({
    name: 'Mink2',
    check: { FILE: 'Scr\\*.sc' },
    certain: false,
    attach() { return attachMink2(); },
});

const E3 = L.engine({
    name: 'Mink3',
    // 夜勤病棟 復刻版+
    check: { FILE_ALL: ['voice*.dat', 'tpd.dat', 'tms.dat', 'thm.dat', 'se.dat', 'scr.dat', 'rec.dat', 'bgm.dat', 'cgm.dat', 'gpd.dat', 'gpdtp.dat', 'mov.dat', 'msk.dat', 'msktp.dat', 'read.dat'] },
    certain: false,
    attach() { return attachMink3(); },
});

module.exports = [E, E2, E3];
if (!module.parent) L.run(E);
