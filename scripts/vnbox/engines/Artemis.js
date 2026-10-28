// Artemis.js: LunaHook's Artemis engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Artemis.cpp and Artemis.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const MAX_REL_ADDR = 0x00300000;

function InsertArtemis1Hook() {
    const bytes = [
        0x83, 0xc4, 0x0c, // add esp,0xc ; hook here
        0x0f, 0xb6, 0xc0, // movzx eax,al
        0x85, 0xc0,       // test eax,eax
        0x75, 0x0e        // jnz XXOO ; it must be 0xe, or there will be duplication
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ecx'),
        split: L.stackoffset(5),
        type: L.NO_CONTEXT | L.DATA_INDIRECT | L.USING_SPLIT, // 0x418
    }, 'Artemis1');
}

function InsertArtemis2Hook() {
    const bytes = [
        0x55,                               // push ebp
        0x8B, 0xEC,                         // mov ebp,esp
        0x83, 0xE4, 0xF8,                   // and esp,FFFFFFF8
        0x6A, 0xFF,                         // push FFFFFFFF
        0x68, ...XX4,                       // push 空のつくりかた体験版_ver3.0.6A7C68
        0x64, 0xA1, 0x00, 0x00, 0x00, 0x00, // mov eax,dword ptr fs:[0]
        0x50,                               // push eax
        0x83, 0xEC, XX,                     // sub esp,28
        0xA1, ...XX4,                       // mov eax,dword ptr ds:[8157F0]
        0x33, 0xC4,                         // xor eax,esp
        0x89, 0x44, 0x24, XX,               // mov dword ptr ss:[esp+20],eax
        0x53,                               // push ebx
        0x56,                               // push esi
        0x57,                               // push edi
        0xA1, ...XX4,                       // mov eax,dword ptr ds:[8157F0]
        0x33, 0xC4,                         // xor eax,esp
        0x50,                               // push eax
        0x8D, 0x44, 0x24, XX,               // lea eax,dword ptr ss:[esp+38]
        0x64, 0xA3, 0x00, 0x00, 0x00, 0x00, // mov dword ptr fs:[0],eax
        0x8B, 0xF1,                         // mov esi,ecx
        0x8B, 0x5D, 0x08,                   // mov ebx,dword ptr ss:[ebp+8]
        0x8B, 0x4D, 0x0C                    // mov ecx,dword ptr ss:[ebp+C]
    ];
    const addr_offset = 0; // distance to the beginning of the function, which is 0x55 (push ebp)
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr += addr_offset;
    const push_ebp = 0x55; // beginning of the function
    if (L.u8(addr) !== push_ebp) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.NO_CONTEXT, filter_fun: L.Utf8TypeChecker }, 'Artemis2');
}

function InsertArtemis3Hook() {
    const bytes = [
        0x55,                                           // push ebp
        0x8B, 0xEC,                                     // mov ebp,esp
        0x83, 0xE4, 0xF8,                               // and esp,FFFFFFF8
        0x83, 0xEC, 0x3C,                               // sub esp,3C
        0xA1, ...XX4,                                   // mov eax,dword ptr ds:[86906C]
        0x33, 0xC4,                                     // xor eax,esp
        0x89, 0x44, 0x24, 0x38,                         // mov dword ptr ss:[esp+38],eax
        0x53,                                           // push ebx
        0x56,                                           // push esi
        0x8B, 0xC1,                                     // mov eax,ecx
        0xC7, 0x44, 0x24, 0x14, 0x00, 0x00, 0x00, 0x00, // mov dword ptr ss:[esp+14],0
        0x8B, 0x4D, 0x0C,                               // mov ecx,dword ptr ss:[ebp+C]
        0x33, 0xF6,                                     // xor esi,esi
        0x57,                                           // push edi
        0x8B, 0x7D, 0x08,                               // mov edi,dword ptr ss:[ebp+8]
        0x89, 0x44, 0x24, 0x14,                         // mov dword ptr ss:[esp+14],eax
        0x89, 0x4C, 0x24, 0x28,                         // mov dword ptr ss:[esp+28],ecx
        0x80, 0x3F, 0x00,                               // cmp byte ptr ds:[edi],0
        0x0F, 0x84, ...XX4,                             // je
        0x83, 0xB8, ...XX4, 0x00,                       // cmp dword ptr ds:[eax+374],0
        0x8B, 0xDF                                      // mov ebx,edi
    ];
    const addr_offset = 0; // distance to the beginning of the function, which is 0x55 (push ebp)
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr += addr_offset;
    const push_ebp = 0x55; // beginning of the function
    if (L.u8(addr) !== push_ebp) return false;
    // EMBED_ABLE | EMBED_AFTER_NEW left out
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING, filter_fun: L.Utf8TypeChecker }, 'EmbedArtemis');
}

function a4() {
    // 高慢な奥さんは好きですか？～傲慢人妻教師の堕とし方～
    const addrs = [];
    for (const func of [L.FindFunction('GetGlyphOutlineA'), L.FindFunction('GetGlyphOutlineW')]) {
        const addrs_ = L.findiatcallormov_all(func, L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE);
        addrs.push(...addrs_);
    }
    let ok = false;
    for (const addr of addrs) {
        const funcaddr = L.findEnclosingAlignedFunction(addr);
        if (!funcaddr) continue;
        const sig1 = [0x81, XX, 0x00, 0x00, 0x10, 0x00];
        const sig2 = [0x68, 0x00, 0x02, 0x00, 0x00, 0x68, 0x00, 0x02, 0x00, 0x00];
        const sig3 = [XX, 0x80, 0x00, 0x00, 0x00, 0x0f, 0x95, 0xc1];
        const sig4 = [0xC1, XX, 0x18];
        let found = 0;
        for (const sig of [sig1, sig2, sig3, sig4]) {
            const fd = L.findBytes(sig, funcaddr, addr);
            if (fd) found += 1;
        }
        if (found === 4) {
            ok = L.NewHook({ address: funcaddr, type: L.CODEC_ANSI_BE, offset: L.stackoffset(2) }, 'Artemis4A') || ok;
            ok = L.NewHook({ address: funcaddr + 5, type: L.CODEC_UTF16, offset: L.stackoffset(2) }, 'Artemis4W') || ok;
            return ok;
        }
    }
    return false;
}

function artemis() {
    // The same as the 64-bit one, but there it is inlined; here it is not, so it takes a xref.
    // (sub_417EF0 in the C++ comments: the byte-class check on the first character of a string)
    const BYTES = [
        0x0f, 0xb6, 0x45, 0x08,
        0x83, 0xf0, 0x20,
        0x2d, 0xa1, 0x00, 0x00, 0x00,
        0x83, 0xf8, 0x3c,
        0x73, ...XX4];
    let addr = L.findBytes(BYTES, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    for (const addr_1 of L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8)) {
        const sig = [0x81, 0x7d, 0xf0, 0xff, 0x03, 0x00, 0x00];
        if (L.findBytes(sig, addr_1, addr_1 + 0x100)) {
            addr = L.findEnclosingAlignedFunction(addr_1);
            if (!addr) return false;
            return L.NewHook({ address: addr, type: L.USING_STRING | L.CODEC_UTF8, offset: L.stackoffset(1) }, 'Artemis');
        }
    }
    return false;
}

function charx() {
    // This hook catches the text with ruby; the others do not, but this one refreshes a single character.
    const BYTES = [
        0X0F, 0XB6, 0XC0,
        0X83, 0XF0, 0X20,
        0X2D, 0XA1, 0X00, 0X00, 0X00,
        0X83, 0XF8, 0X3C,
        0X73, XX,
        0XBF, 0X01, 0X00, 0X00, 0X00,
        0XEB, XX,
        0X83, XX, ...XX4, 0X01,
        0X75, XX,
        0X3C, 0XA1,
        0X72, 0X04,
        0X3C, 0XF4,
        0X76, 0X04,
        0X3C, 0X8E,
        0X75, XX];
    const addr = L.findBytes(BYTES, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const faddr = L.findEnclosingAlignedFunction(addr, 0x200);
    if (!faddr) return false;
    const CHECK = [0XC7, 0X07, ...XX4];
    const addr2 = L.findBytes(CHECK, addr, faddr);
    if (!addr2) return false;
    if (!L.IsBadReadPtr(L.u32(addr2 + 2), 4)) return false;
    return L.NewHook({
        address: faddr,
        type: L.USING_STRING,
        offset: L.stackoffset(2),
        filter_fun: L.Utf8TypeChecker,
    }, 'artemis::CTextLayer::COneLine::COneBlock');
}

const E = L.engine({
    name: 'Artemis',
    check: () => L.CheckFile('*.pfs') ||
        L.CheckFileAll(['scenario/asbmacro.asb', 'scenario/main.iet', 'scenario/main/*.asb',
            'system/*.asb', 'system/*.iet']),
    files: ['*.pfs'],
    attach() {
        // `|` in C++: both sides always run
        const first = charx() || artemis();
        const second = InsertArtemis1Hook() || InsertArtemis2Hook() || InsertArtemis3Hook() || a4();
        return first || second;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
