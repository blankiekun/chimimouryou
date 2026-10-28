// BGI.js: LunaHook's BGI engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/BGI.cpp and BGI.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const MAX_REL_ADDR = 0x00300000;

// BGI hook: usually the game folder contains BGI.*. BGI has a font caching issue, so the strategy is to
// find the call to TextOutA or TextOutW, then reverse to the function entry point, until the full text
// is caught. ESP splits the text since it is likely to differ between calls.

function InsertBGI1Hook() {
    // a hand-written loop over the code, as in C++ (a union of DWORD i, DWORD *id and BYTE *ib)
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const ib = (a) => (a >= base && a - base < b.length ? b[a - base] : 0);
    const id = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress; i++) {
        if (ib(i) === 0x3d) {
            i++;
            if (id(i) === 0xffff) { // cmp eax,0xffff
                const address = L.findEnclosingAlignedFunction(i, 0x40);
                if (address) {
                    return L.NewHook({ address, offset: L.stackoffset(3), split: L.regoffset('esp'), type: L.CODEC_ANSI_BE | L.USING_SPLIT }, 'BGI');
                }
            }
        }
        if (ib(i) === 0x81 && ((ib(i + 1) & 0xf8) === 0xf8)) {
            i += 2;
            if (id(i) === 0xffff) { // cmp reg,0xffff
                const address = L.findEnclosingAlignedFunction(i, 0x40);
                if (address) {
                    return L.NewHook({ address, offset: L.stackoffset(3), split: L.regoffset('esp'), type: L.CODEC_ANSI_BE | L.USING_SPLIT }, 'BGI');
                }
            }
        }
    }
    // SwitchTrigger(true); trigger_fun = InsertBGIDynamicHook: trigger_fun is not supported
    return false;
}

let textIndex_ = 0; // the i-th argument on the stack holding the text
// The C++ also sets *role (Engine::ScenarioRole/NameRole) from the return address and neighbouring
// arguments for translation embedding; roles are not used here, only the text.
function hookBefore(s, hp, buffer, split) {
    const text = s.stack[textIndex_]; // arg2 or arg3
    if (!text || !L.u8(text)) return;
    buffer.fromCharPtr(text);
}

// the beginning of the function holding the text: search1 (BGI1), search2 (BGI2), search3 (newer BGI2)
function search1(startAddress, stopAddress) {
    const bytes = [
        // 0fafcbf7e9c1fa058bc2c1e81f03d08bfa85ff
        0x0f, 0xaf, 0xcb, // imul ecx,ebx
        0xf7, 0xe9,       // imul ecx
        0xc1, 0xfa, 0x05, // sar edx,0x5
        0x8b, 0xc2,       // mov eax,edx
        0xc1, 0xe8, 0x1f, // shr eax,0x1f
        0x03, 0xd0,       // add edx,eax
        0x8b, 0xfa,       // mov edi,edx
        0x85, 0xff,       // test edi,edi
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return 0;
    const sub_esp = 0xec81; // 81ec 30090000
    const push_ff = 0xff6a; // 6a ff   push -0x1, seh handler
    for (let i = 0; i < 300; i++, addr--) {
        if (L.u16(addr) === sub_esp) { // beginning of the function without seh
            // Sample game: 世界征服彼女 with SEH
            // 6a ff / 68 78634900 / 64:a1 00000000 / 50 / 64:8925 00000000 / 81ec d80c0000 sub esp,0xcd8
            // 0x00427465 - 0x00427450 == 21
            let seh_addr = addr;
            for (let j = 0; j < 40; j++, seh_addr--)
                if (L.u16(seh_addr) === push_ff) // beginning of the function with seh
                    return seh_addr;
            return addr;
        }
    }
    return 0;
}

function search2(startAddress, stopAddress) {
    const bytes = [
        // 3c207d750fbec083c0fe83f806776a
        0x3c, 0x20,       // cmp al,0x20
        0x7d, 0x75,       // jge short
        0x0f, 0xbe, 0xc0, // movsx eax,al
        0x83, 0xc0, 0xfe, // add eax,-0x2     ;  switch (cases 2..8)
        0x83, 0xf8, 0x06, // cmp eax,0x6
        0x77, 0x6a        // ja short
    ];
    const hook_offset = 0x34c80 - 0x34d31; // distance to the beginning of the function
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return 0;
    addr = (addr + hook_offset) >>> 0;
    const push_ebp = 0x55; // 011d4c80  /$ 55             push ebp
    if (L.u8(addr) !== push_ebp) return 0;
    return addr;
}

function search3(startAddress, stopAddress) {
    const bytes = [
        // 3c207d580fbec083c0fe83f806774d
        0x3c, 0x20,       // cmp al,0x20     ; jichi: pattern starts
        0x7d, 0x58,       // jge short
        0x0f, 0xbe, 0xc0, // movsx eax,al
        0x83, 0xc0, 0xfe, // add eax,-0x2     ;  switch (cases 2..8)
        0x83, 0xf8, 0x06, // cmp eax,0x6
        0x77, 0x4d        // ja short
    ];
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return 0;
    // distance to the beginning of the function
    const hook_offsets = [
        0x01312cd0 - 0x01312d8e, // for new BGI2 game since 蒼の彼方 (2014/08), text is in arg2
        0x00a64260 - 0x00a64318, // For newer BGI2 game since コドモノアソビ (2015/11)
    ];
    for (let i = 0; i < hook_offsets.length; i++) {
        const hook_offset = hook_offsets[i];
        const push_ebp = 0x55;
        if (L.u8(addr + hook_offset) === push_ebp) return (addr + hook_offset) >>> 0;
    }
    return 0; // failed
}

// returns { funaddr, addr } or null
function search_tayutama() {
    const bytes = [
        // The following code does not exist in newer BGI games after BGI 1.633.0.0 (tayutama2_trial_EX)
        // 0x3c, 0x20, 0x7d, XX
        0x0f, 0xbe, 0xc0, // movsx eax,al
        0x83, 0xc0, 0xfe, // add eax,-0x2               ;  switch (cases 2..8)
        0x83, 0xf8        // cmp eax,0x6 (the 0x06 and the following ja do not exist in newer games after 蒼の彼方)
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return null;
    const funaddr = L.findEnclosingAlignedFunction(addr, 0x300); // range is around 177 ~ 190
    const push_ebp = 0x55;
    if (!funaddr || L.u8(funaddr) !== push_ebp) return null;
    return { funaddr, addr };
}

function InsertBGI2Hook() {
    // Artikash 6/14/2019: the first difference below (the one detecting offset=arg3) might be four bytes
    // off for https://vndb.org/v8158, so a corrected case was added; all others fall through to arg2.
    let addr;
    const t = search_tayutama();
    if (t) {
        addr = t.addr;
        switch ((t.funaddr - t.addr) | 0) {
        // for old BGI2 game, text is arg3
        case 0x34c80 - 0x34d31: // old offset
        case 0x34c50 - 0x34d05: // correction as mentioned above
            textIndex_ = 3;
            break;
        // for new BGI2 game since 蒼の彼方 (2014/08), text is in arg2
        case 0x01312cd0 - 0x01312D92:
        // For newer BGI2 game since コドモノアソビ (2015/11)
        case 0x00A64260 - 0x00A6431C:
        // For latest BGI2 game since タユタマ２(2016/05) by @mireado
        case 0x00E95290 - 0x00E95349:
        // For latest BGI2 game since 千の刃濤、桃花染の皇姫 体験版  by @mireado
        case 0x00AF5640 - 0x00AF56FF:
        // For latest BGI2 game since by BGI 1.633.0.0 @mireado
        case 0x00D8A660 - 0x00D8A73A:
            textIndex_ = 2;
            break;
        // Artikash 8/1/2018: looks like it's basically always 4*2.
        default:
            textIndex_ = 2;
            break;
        }
        addr = t.funaddr;
    } else if ((addr = search3(L.processStartAddress, L.processStopAddress))) {
        textIndex_ = 2; // use arg2, name = "BGI2";
    } else if ((addr = search2(L.processStartAddress, L.processStopAddress))) {
        textIndex_ = 3; // use arg3, name = "BGI2";
    } else if ((addr = search1(L.processStartAddress, L.processStopAddress))) {
        textIndex_ = 3; // use arg3, name = "BGI";
    }
    if (!addr) return false;
    // embed_hook_font, embed_fun and the EMBED_* flags left out (translation embedding)
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(textIndex_),
        // jichi 5/12/2014: Using split could distinguish name and choices. But the signature might become unstable
        type: L.USING_STRING | L.USING_SPLIT | L.NO_CONTEXT,
        text_fun: hookBefore,
        filter_fun(buffer) {
            // It could be either <R..> or <r..>
            let result = buffer.strA();
            result = result.replace(new RegExp('<r.+?>(.+?)</r>', 'gi'), '$1'); // re::sub with icase
            if (result.endsWith('\n')) {
                result = result.substr(0, result.length - 1);
            }
            buffer.fromA(L.strReplace(result, '\x04'));
        },
        split: L.stackoffset(8), // pseudo arg8
    }, 'EmbedBGI');
}

function BGI7Filter(buffer) {
    L.CharFilterW(buffer, '\x01');
    L.CharFilterW(buffer, '\x02');
    L.CharFilterW(buffer, '\x03');
    L.CharFilterW(buffer, '\x04');
    L.CharFilterW(buffer, '\x05');
    L.CharFilterW(buffer, '\x0A');
    L.CharFilterW(buffer, '▼');
    L.StringFilterBetweenW(buffer, '<', '>');
}

// not used by any hook in LunaHook either
function BGI56Filter(buffer) {
    const text = buffer.viewA();
    if (text[0] === '@') {
        buffer.fromA(text.substr(1)); // buffer->size -= 1; memmove(text, text + 1, size)
    }
}

function InsertBGI4Hook_1() {
    // int __cdecl sub_4A3AD0(LPSTR lpMultiByteStr, LPCWCH lpWideCharStr, int a3): a wrapper of WideCharToMultiByte
    const bytes = [
        0xBE, 0xE9, 0xFD, 0x00, 0x00, // cp=65001
        0xeb, XX,
        0xBE, 0xA4, 0x03, 0x00, 0x00  // cp=932
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_UTF16 | L.USING_STRING, filter_fun: BGI7Filter, offset: L.GETARG(2) }, 'BGI4');
}

function InsertBGI4Hook_2() {
    // movzx eax, byte ptr [ecx] / or eax, 0F000h ... / movzx eax, byte ptr [ecx] / or eax, 0EF00h
    const bytes = [
        0x0F, 0xB6, 0x01,
        0x0D, 0x00, 0xF0, 0x00, 0x00,
        0xeb, XX,
        0x0F, 0xB6, 0x01,
        0x0D, 0x00, 0xEF, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addrs.length !== 1) return false;
    // EMBED_ABLE | EMBED_AFTER_NEW and embed_hook_font left out
    return L.NewHook({ address: addrs[0] + 5, type: L.CODEC_UTF16 | L.USING_STRING, filter_fun: BGI7Filter, offset: L.regoffset('eax') }, 'BGI');
}
function InsertBGI4Hook() {
    return InsertBGI4Hook_2() || InsertBGI4Hook_1();
}

function veryold() {
    // 紅月－くれないつき－ / あの街の恋の詩 / H2O -FOOTPRINTS IN THE SAND-
    const fn = L.FindFunction('GetGlyphOutlineA');
    let addr = L.findiatcallormov(fn, L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) // 銀行淫～堕ちゆく女達～ //mov ebp, ds:GetGlyphOutlineA
        addr = L.findiatcallormov(fn, L.processStartAddress, L.processStartAddress, L.processStopAddress, false, XX);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const xrefs = L.findxref_reverse_checkcallop(addr, addr - 0x1000, addr + 0x1000, 0xe8);
    if (xrefs.length !== 1) return false;
    const xrefaddr = xrefs[0];
    const funcstart = L.findEnclosingAlignedFunction(xrefaddr);
    if (funcstart === 0) return false;
    const sig = [0x81, XX, 0x00, 0x01, 0x00, 0x00]; // cmp ebx, 100h
    if (L.findBytes(sig, xrefaddr - 0x40, xrefaddr) === 0) return false;
    return L.NewHook({ address: funcstart, offset: L.stackoffset(2), split: L.stackoffset(1), type: L.CODEC_ANSI_BE | L.USING_SPLIT }, 'BGI5');
}

// jichi 5/12/2014: BGI1 and BGI2 games can co-exist, such as 世界と世界の真ん中で. BGI1 can exist in both
// old and new games, BGI2 only in new games; insert BGI2 first.
const E = L.engine({
    name: 'BGI',
    check: { FILE_ANY: ['bgi.*', 'sysgrp.arc'] },
    attach() {
        if (InsertBGI4Hook()) return true;
        // PcHooks::hookOtherPcFunctions() runs before InsertBGI1Hook in LunaHook; libLuna has no equivalent
        return InsertBGI2Hook() || InsertBGI1Hook() || veryold();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
