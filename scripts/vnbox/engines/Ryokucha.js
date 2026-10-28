// Ryokucha.js: LunaHook's Ryokucha engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Ryokucha.cpp and Ryokucha.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// SpecialHookRyokucha and InsertRyokuchaDynamicHook (trigger_fun on GetGlyphOutlineA, walking the SEH chain
// for the 'StudioRyokucha' hook) are left out: VNBox has no trigger_fun.
// Note: LunaHook's attach_function returns true even when no hook was added; the ports return whether a
// text hook beyond the GDI exports was added (the GDI hooks are the fallback anyway).
function InsertRyokuchaHook() {
    L.hookGDIFunctions();
}

function InsertScenarioPlayerHook() {
    // PcHooks::hookOtherPcFunctions() has no equivalent in libLuna: left out
    const bytes = [
        0x74, 0x14, // 00609c25  |. 74 14          je short あや�00609c3b
        0x5f, // 00609c27  |. 5f             pop edi
        0xb0, 0x01, // 00609c28  |. b0 01          mov al,0x1
        0x5b, // 00609c2a  |. 5b             pop ebx
        0x8b, 0x4d, 0xf4, // 00609c2b  |. 8b4d f4        mov ecx,dword ptr ss:[ebp-0xc]
    ];
    // distance to the beginning of the function
    const addr_offset_A = 0x00609bf0 - 0x00609c25; // -53
    const addr_offset_W = 0x00406540 - 0x00406572; // -50
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const start = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!start) return false;

    const addr = L.findEnclosingAlignedFunction(start, 80); // range is around 50, use 80
    const push_ebp = 0x55; // 011d4c80  /$ 55             push ebp
    if (!addr || L.u8(addr) !== push_ebp) return false;
    const hp = { address: addr, offset: L.stackoffset(1) };
    let succ = false;
    if (((addr - start) === addr_offset_W) ||
        (L.FindImportEntry(L.processStartAddress, L.FindFunction('GetGlyphOutlineA')) === 0 &&
         L.FindImportEntry(L.processStartAddress, L.FindFunction('TextOutA')) === 0 &&
         L.FindImportEntry(L.processStartAddress, L.FindFunction('ExtTextOutA')) === 0 &&
         L.FindImportEntry(L.processStartAddress, L.FindFunction('GetTextExtentPoint32A')) === 0)
        // 祝福の鐘の音は、桜色の風と共に
    ) {
        // Artikash 8/18/2018: can't figure out how to tell apart which hook is needed, so alert user
        hp.type = L.CODEC_UTF16;
        succ = L.NewHook(hp, 'ScenarioPlayerW');
    } else {
        hp.type = L.CODEC_ANSI_BE; // 4
        succ = L.NewHook(hp, 'ScenarioPlayerA');
    }
    void addr_offset_A;
    return succ;
}

function InsertScenarioPlayerHookx() {
    // 夏彩恋呗
    // 为避免和engine中的冲突，进行一次xref
    const bytes = [0xC1, 0xE8, 0x02, 0x25, 0x01, 0xFF, 0xFF, 0xFF, 0x89, 0x45, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr, 0xe9);
    if (addrs.length !== 1) return false;
    addr = addrs[0];
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_UTF16 }, 'sutajioryokutyaW');
}

function Iyashikei() {
    // 癒し系ソープ嬢ヒロさん
    const bytes = [
        0x6A, 0xFF,
        0x68, ...XX4,
        0x64, 0xA1, 0x00, 0x00, 0x00, 0x00,
        0x50,
        0x83, 0xEC, 0x08,
        0x56,
        0xA1, 0x08, 0x6E, 0x6B, 0x00,
        0x33, 0xC4,
        0x50,
        0x8D, 0x44, 0x24, XX,
        0x64, 0xA3, 0x00, 0x00, 0x00, 0x00,
        0x8B, 0xF1,
        0x8B, 0x44, 0x24, XX,
        0x50,
        0x8D, 0x4C, 0x24, XX,
        0x51,
        0x8B, 0xCE,
        0xE8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'Iyashikei');
}

function InsertScenarioPlayerHook_all() {
    const b1 = InsertScenarioPlayerHook();
    const b2 = InsertScenarioPlayerHookx();
    return b1 || b2 || Iyashikei();
}

function RyokuchaAttach() {
    InsertRyokuchaHook();
    let ok = false;
    if (L.CheckFile('*.iar') && L.CheckFile('*.sec5')) // jichi 9/27/2014: For new Ryokucha games
        ok = InsertScenarioPlayerHook_all();
    return ok;
}

const E = L.engine({
    name: 'Ryokucha',
    check: { FILE: '*_checksum.exe' },
    attach: RyokuchaAttach,
});

const E2 = L.engine({
    name: 'Ryokucha2',
    check: { FILE: 'sc\\*.scc' },
    certain: false,
    attach() {
        // 夏日
        const bytes = [0x8b, ...XX2, 0x2b, 0xd1, 0xc1, 0xfa, 0x02, 0x3b, 0xd0, 0x76];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            offset: L.stackoffset(6),
            type: L.USING_STRING,
            filter_fun(buffer) {
                const s = buffer.viewA();
                if (s[0] === '#') buffer.clear();
            },
        }, 'sutajioryokutya');
    },
});

const E3 = L.engine({
    name: 'ScenarioPlayer_last',
    check: { FILE_ALL: ['*.iar', '*.sec5'] },
    attach() { return InsertScenarioPlayerHook_all(); },
});

// Ryokuchaold extends Ryokucha (same attach_function, its own check)
const E4 = L.engine({
    name: 'Ryokuchaold',
    check: { FILE_ALL: ['img\\*.iar', '*.sec5'] },
    certain: false,
    attach: RyokuchaAttach,
});

module.exports = [E, E2, E3, E4];
if (!module.parent) { L.run(E); L.run(E2); L.run(E3); L.run(E4); }
