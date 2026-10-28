// Candy.js: LunaHook's Candy engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Candy.cpp and Candy.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// CandySoft hook: the game folder contains many *.fpk; the engine is called SystemC. The script
// processing function needs to find 0x5B '[', so there is an instruction like cmp reg,5B; find it and
// navigate to the function entry. The first parameter is the string pointer. The original つよきす is
// quite different and is handled separately.

// https://vndb.org/v23666, https://vndb.org/v47957, https://vndb.org/v20368
function filter(buffer) {
    L.StringFilterA(buffer, '$L');
    L.StringFilterA(buffer, '$M');
    L.StringFilterA(buffer, '$S');
    L.StringFilterBetweenA(buffer, '[', ']');
    L.StringFilterBetweenA(buffer, '&', ';');
    // (LunaHook keeps the decompiled switch over '$', '[' and '&' as a comment here)
}

function hh() {
    // void __usercall sub_425580(char *a1@<edx>, int a2@<ecx>, int a3)
    const bytes = [
        0x3c, 0x24,
        0x75, XX,
        0x80, 0x7e, 0x01, 0x00,
        0x74, XX,
        0x83, XX, 0x02,
        0x83, XX, 0x02];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return 0;
    addr = L.findfuncstart(addr, 0x400);
    return addr;
}

// dword reads over the exe image for the hand-written scans below
function imageReader() {
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    return (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
}

// jichi 8/23/2013: split into two different engines
// if (_wcsicmp(processName, L"systemc.exe")==0)
// Process name is "SystemC.exe"
function InsertCandyHook1() {
    const id = imageReader();
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++)
        if ((id(i) & 0xffffff) === 0x24f980) // cmp cl,24
            for (let j = i, k = i - 0x100; j > k; j--)
                if (id(j) === 0xc0330a8a) { // mov cl,[edx]; xor eax,eax
                    return L.NewHook({ address: j, offset: L.regoffset('edx'), type: L.USING_STRING }, 'SystemC');
                }
    return false;
}

function __InsertCandyHook2() {
    const id = imageReader();
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++)
        if ((id(i) & 0xffff) === 0x5b3c || // cmp al,0x5b
            (id(i) & 0xfff8fc) === 0x5bf880) // cmp reg,0x5B
            for (let j = i, k = i - 0x100; j > k; j--)
                if ((id(j) & 0xffff) === 0x8b55) { // push ebp, mov ebp,esp, sub esp,*
                    return j;
                }
    return 0;
}

// jichi 8/23/2013: Process name is NOT "SystemC.exe"
function InsertCandyHook2() {
    let addr1 = hh(); // 新版本的candy，但是有时会和旧版在同一个地址。当是同一个地址时，避让5个字节
    const addr2 = __InsertCandyHook2();
    const hp = { type: L.USING_STRING, filter_fun: filter };
    if (addr2 === 0 && addr1 === 0)
        return false;
    else if (addr2 === 0 && addr1 !== 0) {
        hp.address = addr1;
        hp.offset = L.regoffset('edx');
        return L.NewHook(hp, 'SystemC');
    } else if (addr2 !== 0 && addr1 === 0) {
        hp.address = addr2;
        hp.offset = L.stackoffset(1); // jichi: text in arg1
        return L.NewHook(hp, 'SystemC');
    } else {
        if (addr1 === addr2) {
            addr1 += 5;
        }
        hp.address = addr1;
        hp.offset = L.regoffset('edx');
        let succ = L.NewHook(hp, 'SystemC');
        hp.address = addr2;
        hp.offset = L.stackoffset(1);
        succ = L.NewHook(hp, 'SystemC') || succ;
        return succ;
    }
}

// InsertCandyHook3 in an `#if 0`-style comment block in LunaHook (the 恋もHもお勉強も hook) is dead code.

function candy3() {
    // お母さんは俺専用！～あなたの初めてを…母さんが貰ってア・ゲ・ル～
    // 茉莉子さん家の性事情 ~伯母さんは僕のモノ~
    const bytes = [
        0x24, // XX||XX2
        0x75];
    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE)) {
        if ((L.u8(addr - 1) === 0x3c) || ((L.u8(addr - 2) === 0x83) && (L.u8(addr - 1) === 0xf9))) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr)
                continue;
            const hp = { type: L.USING_STRING };
            if (L.u8(addr) === 0x55)
                hp.offset = L.stackoffset(1);
            else if (L.u8(addr) === 0x56)
                hp.offset = L.regoffset('eax');
            else
                continue;
            hp.address = addr;

            return L.NewHook(hp, 'candy3');
        }
    }
    return false;
}

function InsertCandyHook3() {
    // Sample games: https://vndb.org/v24878
    const bytes = [
        0xCC, // int 3
        0x55, // push ebp        << hook here
        0x8B, 0xEC, // mov ebp,esp
        0x6A, 0xFF, // push -01
        0x68, ...XX4, // push iinari-omnibus.exe+C4366
        0x64, 0xA1, 0x00, 0x00, 0x00, 0x00, // mov eax,fs:[00000000]
        0x50, // push eax
        0x83, 0xEC, 0x74, // sub esp,74
        0x53, // push ebx
        0x56, // push esi
        0x57]; // push edi

    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr)
        return false;
    return L.NewHook({ address: addr + 1, offset: L.stackoffset(4), type: L.USING_STRING | L.CODEC_UTF16 }, 'SystemC#3');
}

// jichi 10/2/2013: Add new candy hook
function InsertCandyHook() {
    if (L.CheckFile('SystemC.exe'))
        return InsertCandyHook1() || candy3();
    // return InsertCandyHook2();
    let b2 = InsertCandyHook2();
    b2 = InsertCandyHook3() || b2;
    return b2;
}

function willowsoft() {
    const bytes = [
        // https://vndb.org/v5761
        // まません
        0xA1, ...XX4,
        0x89, 0x45, 0xF8,
        0x83, 0x7D, 0xF8, 0x10,
        0x74, XX,
        0x83, 0x7D, 0xF8, 0x18,
        0x74, XX,
        0x83, 0x7D, 0xF8, 0x20,
        0x74, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x20);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'WillowSoft');
}

const E = L.engine({
    name: 'Candy',
    check: { FILE_ANY: ['*.fpk', 'data\\*.fpk'] },
    certain: false,
    attach() {
        // PcHooks::hookOtherPcFunctions() runs after these in LunaHook (also when nothing matched); libLuna has no equivalent.
        let b1 = InsertCandyHook();
        if (!b1)
            b1 = willowsoft();
        return b1;
    },
});

const E2 = L.engine({
    name: 'WillowSoft',
    check: { FILE: 'Selene.dll' },
    certain: false,
    attach() {
        // お母さんがいっぱい!!限定ママBOX
        const bytes = [
            0xF7, 0xC2, 0x00, 0x00, 0xFF, 0x00,
            ...XX2,
            0xF7, 0xC2, 0x00, 0x00, 0x00, 0xFF,
            ...XX2];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr)
            return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr)
            return false;

        return L.NewHook({
            address: addr,
            type: L.USING_STRING | L.FULL_STRING,
            text_fun(context, hp, buffer) {
                // 裸執事
                const src = context.stack[2];
                if (hp.user_value === 0)
                    if (L.IsBadReadPtr(L.u32(src), 0x100))
                        hp.user_value = 1;
                    else
                        hp.user_value = 2;

                buffer.fromCharPtr(hp.user_value === 2 ? L.u32(src) : src);
            },
            filter_fun: willowFilter,
        }, 'WillowSoft');
    },
});

let lastWillow = ''; // static std::string last
function willowFilter(buffer) {
    let s = buffer.strA();
    if (L.all_ascii(s))
        return buffer.clear();

    if (lastWillow === s)
        return buffer.clear();
    lastWillow = s;
    s = L.re.sub(s, String.raw`(\x81\x40)*[\n\r](\x81\x40)*`);
    buffer.fromA(s);
}

module.exports = [E, E2];
if (!module.parent) L.run([E, E2]);
