// Leaf.js: LunaHook's Leaf engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Leaf.cpp and Leaf.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: hook2a (embed_fun), the EMBED flags; veryveryold (kizuato/sizuku/ToHeart's old engines read
// LunaHook's built-in kizfont/sizfont/thfont character-set resources, which VNBox does not have).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 12/25/2014: Leaf/AQUAPLUS */
let save = ''; // std::string save

function SpecialHookLeaf(context, hp, buffer, split) {
    const text = context.ebx - 1; // = ebx -1
    save = L.readA(text);
    buffer.fromA(save);
}
function LeafFilter(buffer) {
    if (buffer.strA().includes('\\')) {
        L.StringFilterA(buffer, '\\n');
        L.StringFilterA(buffer, '\\k');
    }
}
function hook2(context, hp, buffer, split) {
    save = L.strReplace(save, '\\k');
    save = L.re.sub(save, String.raw`<R(.+?)\|.+>`, '$1');
    buffer.fromA(save);
}

function InsertLeafHook() {
    const bytes = [
        0x8b, 0x90, ...XX4,       // 00451658   8b90 c08c0000    mov edx,dword ptr ds:[eax+0x8cc0]
        0x8b, 0x84, 0x97, ...XX4, // 0045165e   8b8497 14080000  mov eax,dword ptr ds:[edi+edx*4+0x814]
        0x8d, 0x58, 0x01, // 00451665   8d58 01          lea ebx,dword ptr ds:[eax+0x1] ; jichi: hook here would crash because of jump
        0x8a, 0x10,       // 00451668   8a10             mov dl,byte ptr ds:[eax]    ; jichi: text accessed here in eax
        0x40,             // 0045166a   40               inc eax
        0x84, 0xd2,       // 0045166b   84d2             test dl,dl
        0x75, 0xf9,       // 0045166d  ^75 f9            jnz short .00451668
        0x2b, 0xc3,       // 0045166f   2bc3             sub eax,ebx     ; jichi: hook here, text in ebx-1
        0x8d, 0x58, 0x01  // 00451671   8d58 01           lea ebx,dword ptr ds:[eax+0x1]
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    const addr_offset = 0x0045166f - 0x00451658;
    if (!addr) return false;

    let succ = L.NewHook({
        address: addr + addr_offset,
        type: L.USING_STRING | L.USING_SPLIT, // use top of the stack as split
        text_fun: SpecialHookLeaf,
        filter_fun: LeafFilter, // remove two characters
    }, 'Leaf');

    const bytes1 = [0x8b, 0x84, 0x97, 0x14, 0x08, 0x00, 0x00],
        bytes2 = [0x8b, 0x8c, 0x97, 0x14, 0x08, 0x00, 0x00];

    const addr1 = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress),
        addr2 = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr1 || !addr2) return true;
    succ = L.NewHook({ address: addr2 + 7, text_fun: hook2, type: L.NO_CONTEXT, lineSeparator: '\\n' }, 'EmbedLeaf') || succ;
    return succ;
}

function activehook() {
    const bytes = [
        0x56,             // push esi                   << hook here
        0xE8, ...XX4,     // call HEARTWORK.EXE+134F0
        0x83, 0xC4, 0x38, // add esp,38
        0x5F,             // pop edi
        0x5D,             // pop ebp
        0x5B,             // pop ebx
        0xE8, ...XX4      // call HEARTWORK.EXE+1AF80
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('ecx'), type: L.USING_STRING }, 'active');
}

function AquaplusFilter(buffer) {
    L.CharReplacerA(buffer, '^', '"');
    L.StringCharReplacerA(buffer, '\\n', ' ');
    L.StringFilterA(buffer, '\\k');
    L.StringFilterA(buffer, '\\p');
    if (buffer.strA().includes('<R')) { // ex. <R華奢|きゃしゃ>
        L.StringFilterA(buffer, '<R');
        L.StringFilterBetweenA(buffer, '|', '>');
    }
    L.StringFilterA(buffer, '<c\0'); // remove "<c" followed by 1 char (length 3 as in the C++: it includes the NUL)
    L.CharFilterA(buffer, '>');
}

function InsertAquaplus1Hook() {
    const bytes = [
        0xCC,                   // int 3
        0x53,                   // push ebx             << hook here
        0x8B, 0x5C, 0x24, 0x0C, // mov ebx,[esp+0C]
        0x55,                   // push ebp
        0x8B, 0x6C, 0x24, 0x0C, // mov ebp,[esp+0C]
        0x56,                   // push esi
        0x57,                   // push edi
        0x8B, 0x7D, 0x24,       // mov edi,[ebp+24]
        0x85, 0xFF              // test edi,edi
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: AquaplusFilter }, 'Aquaplus1');
}

function InsertAquaplus2Hook() {
    const bytes = [
        0xC6, 0x04, 0x30, 0x00, // mov byte ptr [eax+esi],00           << hook here
        0x8B, 0xF2,             // mov esi,edx
        0x8A, 0x02,             // mov al,[edx]
        0x42,                   // inc edx
        0x84, 0xC0,             // test al,al
        0x75, 0xF9              // jne "WHITE ALBUM Memories like Falling Snow.exe"+85253
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ebx'),
        index: 0,
        split: L.regoffset('esp'),
        split_index: 0,
        type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT | L.CODEC_UTF8,
        filter_fun: AquaplusFilter,
    }, 'Aquaplus2');
}

function InsertAquaplus3Hook() {
    const bytes = [
        0xCC,                    // int 3
        0x80, 0x3D, ...XX4, 0x00, // cmp byte ptr [DT2_en.exe+3052EC],00    << hook here
        0x75, 0x67,              // jne DT2_en.exe+89DC0
        0x56,                    // push esi
        0xBA, ...XX4             // mov edx,DT2_en.exe+3051E0
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 1,
        offset: L.regoffset('eax'),
        type: L.CODEC_UTF8 | L.USING_STRING | L.NO_CONTEXT,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'Aquaplus3');
}

function InsertAquaplusHooks() {
    return InsertAquaplus1Hook() || InsertAquaplus2Hook() || InsertAquaplus3Hook();
}

let kizuatoLast = ''; // static std::string last
function kizuato() {
    const bytes = [
        0x3c, 0xa0,
        0x0f, 0x82, ...XX4,
        0x3c, 0xe0,
        0x0f, 0x83];
    const bytes2 = [
        0x80, 0xf9, 0xa0,
        0x0f, 0x82, ...XX4,
        0x80, 0xf9, 0xe0,
        0x0f, 0x83];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const subespbegin = [0x81, 0xEC, XX, 0x01, 0x00, 0x00];
    addr = L.reverseFindBytes(subespbegin, addr - 0x500, addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun(context, hp, buffer, split) {
            if ((context.stack[16] | 0) === -1) return;
            let current = L.readA(context.stack[13]);
            // std::sregex_token_iterator(-1): the pieces between separators, no captures, no trailing empty piece
            const spls = L.re.split(current, String.raw`\\k|\\s`);
            if (spls.length && spls[spls.length - 1] === '') spls.pop();
            current = spls[context.stack[16]];
            if (current === undefined) return;
            if (kizuatoLast === current) return;
            kizuatoLast = current;

            current = L.strReplace(current, '\\n');
            current = L.strReplace(current, '\\k');
            current = L.strReplace(current, '\\s');
            current = L.re.sub(current, String.raw`<R(.*?)\|(.*?)>`, '$1');
            current = L.re.sub(current, String.raw`<[A-Za-z]\d*(.*?)>`, '$1');
            buffer.fromA(current);
        },
    }, 'kizuato');
}

// int __cdecl sub_40DE00(char *Source, int a2): WHITE ALBUM 2's text window
function wa2special() {
    const sig = [
        0x6A, 0x01, 0x6A, 0x28, 0x6A, 0x20, 0x6A, 0x0E, 0x6A, 0x00, 0x6A, 0x0F, 0x6A, 0x28, 0x6A, 0x1C
    ];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction_strict(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.NO_CONTEXT,
        lineSeparator: '\\n',
        filter_fun: AquaplusFilter,
    }, 'wa2special');
}

function toheartpse() {
    // int __cdecl sub_414C00(int a1, int a2, int a3, int a4, int a5, int a6, int a7): a5 == 33116 || a5 == 33951
    const sig = [
        0x8b, 0x7c, 0x24, 0x24,
        0x85, 0xc9,
        0x75, XX,
        0x8b, 0x0d, ...XX4,
        0x85, 0xc9,
        0x74, XX,
        0x81, 0xff, 0x5c, 0x81, 0x00, 0x00,
        0x74, XX,
        0x81, 0xff, 0x9f, 0x84, 0x00, 0x00,
        0x75, XX];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(5), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'toheartpse');
}

function filsnown() {
    const sig = [
        0x8b, 0x45, 0x14,
        0x3d, 0x40, 0x81, 0x00, 0x00,
        0x0f, 0x84, ...XX4,
        0x83, 0xf8, 0x20,
        0x0f, 0x86, ...XX4,
        0x3d, 0xd0, 0x00, 0x00, 0x00,
        0x73, XX,
        0xC7, 0x45, XX, 0x01, 0x00, 0x00, 0x00,
        0x8b, 0x04, 0x85, ...XX4,
        0x89, 0x45, XX,
        0xeb, XX,
        0x3d, 0x40, 0x81, 0x00, 0x00,
        0x72, XX,
        0x3d, 0xa0, 0x83, 0x00, 0x00,
        0x73, XX];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(4), type: L.USING_CHAR | L.CODEC_ANSI_BE }, 'filsnown');
}

// veryveryold(): skipped, see the header

const E = L.engine({
    name: 'Leaf',
    check: { FILE_ANY: ['*.pak', 'Data\\*.pck'] },
    certain: false,
    attach() {
        return InsertLeafHook() || activehook() || InsertAquaplusHooks() || kizuato() || wa2special() || toheartpse() || filsnown();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
