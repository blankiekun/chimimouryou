// Atelier.js: LunaHook's Atelier and Atelier2 engines for VNBox (libLuna.js runs them).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Atelier.cpp and Atelier.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const MAX_REL_ADDR = 0x00300000;

// AtelierKaguya hook: the game folder contains message.dat. Used by AtelierKaguya games; usually has a
// font caching issue with TextOutA. A loop in the called function traverses the string one character at
// a time; the instruction add esi,0x40 locates it.
function InsertAtelierHook() {
    // LunaHook runs PcHooks::hookOtherPcFunctions() here (lstrlenA gives a good hook too); libLuna has no equivalent.
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const id = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
    let i;
    for (i = L.processStartAddress; i < L.processStopAddress - 4; i++) {
        const sig = id(i) & 0xffffff;
        if (0x40c683 === sig) // add esi,0x40
            break;
    }
    if (i < L.processStopAddress - 4) {
        for (const j = i - 0x200; i > j; i--) {
            if (id(i) === 0xff6acccc) { // find the function entry
                return L.NewHook({
                    address: i + 2,
                    offset: L.stackoffset(2),
                    split: L.regoffset('esp'),
                    type: L.USING_SPLIT,
                }, 'Atelier KAGUYA');
            }
        }
    }
    return false;
}

function InsertAtelierKaguya2Hook() {
    const bytes = [
        0x51,             // push ecx        << hook here
        0x50,             // push eax
        0xE8, ...XX4,     // call Start.exe+114307
        0x83, 0xC4, 0x08, // add esp,08
        0x85, 0xC0,       // test eax,eax
        0x78, 0xA1        // js Start.exe+48947
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    // EMBED_AFTER_OVERWRITE | EMBED_ABLE | EMBED_DYNA_SJIS and embed_hook_font left out
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'Atelier KAGUYA2');
}

function InsertAtelierKaguya3Hook() {
    const bytes = [
        0x55,                              // push ebp       << hook here
        0x8B, 0xEC,                        // mov ebp,esp
        0x6A, 0xFF,                        // push -01
        0x68, 0x80, 0xB9, 0x4D, 0x00,      // push Start.exe+DB980
        0x64, 0xA1, ...XX4,                // mov eax,fs:[00000000]
        0x50,                              // push eax
        0x51,                              // push ecx
        0x81, 0xEC, 0xAC, 0x00, 0x00, 0x00 // sub esp,000000AC
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'Atelier KAGUYA3');
}

function InsertAtelierKaguya4Hook() {
    const bytes = [
        0xE8, 0x90, 0xA8, 0xFF, 0xFF, // call Start.exe+18380
        0x89, 0x45, 0xF8,             // mov [ebp-08],eax
        0x8B, 0x4D, 0x10,             // mov ecx,[ebp+10]
        0x51,                         // push ecx
        0x8B, 0x55, 0x0C,             // mov edx,[ebp+0C]
        0x52,                         // push edx
        0x8B, 0x45, 0x08,             // mov eax,[ebp+08]
        0x50                          // push eax       << hook here
    ];
    const addr_offset = bytes.length - 1;
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'Atelier KAGUYA4');
}

function InsertAtelierKaguya5Hook() {
    const bytes = [
        0xC2, 0x04, 0x00, // ret 0004
        0x55,             // push ebp       << hook here
        0x8B, 0xEC,       // mov ebp,esp
        0x6A, 0xFF,       // push -01
        0x68, ...XX4,     // push Start.exe+DA680
        0x64, 0xA1, 0x00, 0x00, 0x00, 0x00, // mov eax,fs:[00000000]
        0x50,             // push eax
        0x51,             // push ecx
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 3,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'Atelier KAGUYA5');
}

function InsertAtelierKaguyaX() {
    // エロティ課 誘惑研修はじまるよ～ しごいちゃうから覚悟なさい!
    const bytes = [
        0x3D, 0xF0, 0x41, 0x00, 0x00,
        0x75];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x1000);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'Atelier KAGUYA3');
}

function Atelier2attach_function() {
    // https://vndb.org/v304 ダンジョンクルセイダーズ～TALES OF DEMON EATER～
    const bytes = [
        0x83, 0xFE, 0x34,
        0xF6, XX,
        0x88, XX, 0x24, 0x29,
        0x7D];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    // NO_CONTEXT: 牝奴隷 ～犯された放課後～ https://vndb.org/v4351 would put every line apart otherwise.
    return L.NewHook({
        address: addr + bytes.length - 1,
        offset: L.stackoffset(10),
        type: L.USING_CHAR | L.NO_CONTEXT,
    }, 'Atelier KAGUYA3');
}

function Atelier2attach_function2() {
    const addr = L.findiatcallormov(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const faddr = L.findEnclosingAlignedFunction(addr);
    if (!faddr) return false;
    let type = L.USING_STRING; // https://vndb.org/v13691  // 肉牝R30 ～肉欲に堕ちた牝たち～
    if (addr - faddr > 0x40)
        type |= L.DATA_INDIRECT; // https://vndb.org/v7264  // 禁断の病棟 特殊精神科医 遊佐惣介の診察記録
    return L.NewHook({ address: faddr, offset: L.stackoffset(3), type }, 'Atelier KAGUYA2');
}

function h3() {
    // 最終痴漢電車DVDエディション
    const bytes = [
        0xa1, ...XX4,
        0x53,
        0x8b, 0x5c, 0x24, 0x08,
        0x56,
        0x8b, 0xf1,
        0x57,
        0x85, 0xdb,
        0x89, 0x06,
        0x74, XX,
        0x8b, 0xc3,
        0xc1, 0xe8, 0x10,
        0x66, 0x85, 0xc0,
        0x75, XX,
        0x0f, 0xb7, 0xc3,
        0x50,
        0xe8, ...XX4, // CString::LoadStringA
        0xeb, XX,
        0x53,
        0xff, 0x15, ...XX4, // lstrlenA
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(1) }, 'Atelier2_1');
}

const E = L.engine({
    name: 'Atelier',
    check: { FILE: 'message.dat' },
    attach() {
        return InsertAtelierHook() || InsertAtelierKaguya2Hook() || InsertAtelierKaguyaX() || InsertAtelierKaguya3Hook() || InsertAtelierKaguya4Hook() || InsertAtelierKaguya5Hook();
    },
});
const E2 = L.engine({
    name: 'Atelier2',
    check: () => L.CheckFileAll(['*.ARC', '*.ARI']) || L.CheckFileAll(['ARC\\*.ARC', 'ARC\\*.ARI']),
    attach() { return h3() || Atelier2attach_function() || Atelier2attach_function2(); },
});

module.exports = [E, E2];
if (!module.parent) L.run([E, E2]);
