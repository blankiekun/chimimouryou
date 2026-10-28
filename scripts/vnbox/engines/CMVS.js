// CMVS.js: LunaHook's CMVS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CMVS.cpp and CMVS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// CMVS hook: process name is cmvs.exe, cnvs.exe or cmvs*.exe. Used by PurpleSoftware games.
// Font caching issue: find the call to GetGlyphOutlineA and the function entry.
// InsertCMVS2Hook is never called in LunaHook (it only lives in the unnamed namespace), so it is left out.

function InsertCMVS1Hook() {
    const funcs = [
        0xec83, // caller pattern: sub esp = 0x83,0xec
        0xec8b55];
    let addr = L.findMultiCallerAddress(L.FindFunction('GetGlyphOutlineA'), funcs, funcs.length, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, false, XX);
        if (!addr)
            return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr)
            return false;
    }

    if ((L.u32(addr - 3) & 0xffffff) === 0xec8b55)
        addr -= 3;
    const hp = {};
    hp.address = addr;
    if (L.u8(addr) === 0x8b) {
        hp.offset = L.stackoffset(3);
    } else
        hp.offset = L.stackoffset(2);
    hp.split = L.regoffset('esp');
    hp.type = L.CODEC_ANSI_BE | L.USING_SPLIT;

    return L.NewHook(hp, 'CMVS');
}

function InsertCMVSHook() {
    return InsertCMVS1Hook();
}

function cmvsfilter(buffer) {
    const str = buffer.strA();
    let result1 = L.re.sub(str, '\\{(.*?)/(.*?)\\}', '$1');
    result1 = L.strReplace(result1, '\\wc');
    result1 = L.strReplace(result1, '\\ws');
    buffer.fromA(result1);
}

// EmbedCMVS: the embed flags are left out, the text hook stays
function attach(pattern, startAddress, stopAddress) {
    let addr = L.findBytes(pattern, startAddress, stopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction_strict(addr);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING, filter_fun: cmvsfilter }, 'EmbedCMVS');
}

function attachScenarioHook(startAddress, stopAddress) {
    const bytes = [
        0xb8, 0xcd, 0xcc, 0xcc, 0xcc, // 004512de   b8 cdcccccc      mov eax,0xcccccccd
        0xf7, 0xe1, // 004512e3   f7e1             mul ecx
        0xc1, 0xea, 0x02, // 004512e5   c1ea 02          shr edx,0x2
        0xd1, 0xe9, // 004512e8   d1e9             shr ecx,1
        0x2b, 0xca]; // 004512ea   2bca             sub ecx,edx

    const bytes_kunado_kukoki = [
        0xf7, 0xe1,
        0x8b, 0x85, 0xd8, 0xfd, 0xff, 0xff,
        0xd1, 0xe9,
        0xc1, 0xea, 0x02,
        0x2b, 0xca];
    return attach(bytes, startAddress, stopAddress) || attach(bytes_kunado_kukoki, startAddress, stopAddress);
}

function attachHistoryHook(startAddress, stopAddress) {
    const bytes = [
        0xb8, 0xcd, 0xcc, 0xcc, 0xcc, // 0044ae11   b8 cdcccccc      mov eax,0xcccccccd
        0xf7, 0xe1, // 0044ae16   f7e1             mul ecx
        0xd1, 0xe9, // 0044ae18   d1e9             shr ecx,1
        0xc1, 0xea, 0x02, // 0044ae1a   c1ea 02          shr edx,0x2
        0x2b, 0xca]; // 0044ae1d   2bca             sub ecx,edx

    return attach(bytes, startAddress, stopAddress);
}

function h2() {
    const BYTES_happymeafd = [
        0x8a, 0x0f,
        0x8a, 0xc1,
        0x3c, 0x5c,
        0x0f, 0x84, ...XX4,
        0x3c, 0x7b,
        0x0f, 0x84, ...XX4,
        0x51,
        0xe8, ...XX4,
        0x85, 0xc0];
    for (const addr of L.SearchMemory(BYTES_happymeafd, L.PAGE_EXECUTE_READWRITE, L.processStartAddress, L.processStopAddress)) {
        const faddr = L.findEnclosingAlignedFunction(addr);
        if (!faddr)
            continue;
        const check = [
            0x66, 0x0f, 0xbe, 0x07,
            0x66, 0x0f, 0xbe, 0x4f, 0x01,
            0x83, 0xc7, 0x02,
            0x66, 0xc1, 0xe0, 0x08,
            0x66, 0x23, 0xcb,
            0x33, 0xdb,
            0x66, 0x0b, 0xc8,
            0xb8, 0x4a, 0x81, 0x00, 0x00];
        if (!L.findBytes(check, addr, addr + 0x100))
            continue;
        return L.NewHook({ address: faddr, offset: L.stackoffset(1), type: L.USING_STRING, filter_fun: cmvsfilter }, 'EmbedCMVS_2');
    }
    return false;
}

const E = L.engine({
    name: 'CMVS',
    // jichi 8/19/2013: matching the process name (cmvs32 / cmvs64) does not work for games like ハピメア
    check: { FILE: 'data\\pack\\*.cpz' },
    attach() {
        let embed = attachScenarioHook(L.processStartAddress, L.processStopAddress);
        if (embed)
            attachHistoryHook(L.processStartAddress, L.processStopAddress);
        embed = h2() || embed;
        return InsertCMVSHook() || embed;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
