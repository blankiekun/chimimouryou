// WillPlus.js: LunaHook's WillPlus, Willold and WillPlusETERNAL engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/WillPlus.cpp and WillPlus.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: embed_fun/hook-after parts (translation embedding), patch_fun (EMBED_DYNA_SJIS patch), and
// InsertOldWillPlusHook with SpecialHookWillPlus (WillPlus1): it walks the return address with LunaHook's length
// disassembler (::disasm), which libLuna lacks, and WillPlus::attach_function never calls it (InsertWillPlusHook(false)).
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

// ::isupper / the text[i] reads of the char and wchar_t templates
const isUpper = (c) => c >= 0x41 && c <= 0x5a;
const charAt = (text, i, wide) => (wide ? L.u16(text + 2 * i) : L.u8(text + i));

// _willplus_trim_a / _willplus_trim_w: the text without leading %XX prefixes and trailing %XX suffixes
function willplusTrim(text, wide) {
    const textSize = wide ? L.wcslen(text) : L.strlen(text);
    let prefix = 0;
    if (charAt(text, 0, wide) === 0x25) { // '%'
        while (prefix < textSize - 1 && charAt(text, prefix, wide) === 0x25 && isUpper(charAt(text, prefix + 1, wide))) {
            prefix += 2;
            while (isUpper(charAt(text, prefix, wide))) prefix++;
        }
    }
    let pos = textSize;
    for (let i = textSize - 1; i >= prefix; i--) {
        const ch = charAt(text, i, wide);
        if (isUpper(ch)) continue;
        else if (ch === 0x25) pos = i;
        else break;
    }
    const suffix = textSize - pos;
    return { text: text + prefix * (wide ? 2 : 1), size: textSize - prefix - suffix };
}

// trim<strT>: sample prefix %LF, sample suffix %L%P%W; returns the text and its length in characters
function trim(text, size, wide) {
    let length = size;
    if (charAt(text, 0, wide) === 0x25) { // handle prefix
        let pos = 0;
        while (pos < length - 1 && charAt(text, pos, wide) === 0x25 && isUpper(charAt(text, pos + 1, wide))) {
            pos += 2;
            while (isUpper(charAt(text, pos, wide))) pos++;
        }
        if (pos) {
            length -= pos;
            text += pos * (wide ? 2 : 1);
        }
    }
    { // handle suffix
        let pos = length;
        for (let i = length - 1; i >= 0; i--) {
            const ch = charAt(text, i, wide);
            if (isUpper(ch)) continue;
            else if (ch === 0x25 && isUpper(charAt(text, i + 1, wide))) pos = i;
            else break;
        }
        length = pos;
    }
    return { text, size: length };
}

function SpecialHookWillPlusA(context, hp, buffer, split) {
    const index = 0;
    let text = context.eax;
    if (!text) return;
    if (index) text -= 1024; // index == 1 is name
    if (!L.u8(text)) return;
    const t = willplusTrim(text, false);
    buffer.from(t.text, t.size);
    split.value = (L.FIXED_SPLIT_VALUE << index) >>> 0;
}

function WillPlus_extra_filter(buffer) {
    // StringFilter(buffer, L"%XS", 5): remove %XS followed by 2 chars
    buffer.fromW(L.re.sub(buffer.strW(), String.raw`%XS[\s\S]{2}`));
    let str = buffer.strW();
    str = L.re.sub(str, String.raw`\\n　*`);
    let result1 = L.re.sub(str, '\\{(.*?):(.*?)\\}', '$1');
    result1 = L.re.sub(result1, '\\{(.*?);(.*?)\\}', '$1');
    result1 = L.re.sub(result1, '%[A-Z]+');
    buffer.fromW(result1);
}

function InsertWillPlusAHook() {
    if (L.findiatcallormov(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStartAddress, L.processStopAddress)) return false;
    // by iov
    const bytes2 = [0x8B, 0x00, 0xFF, 0x76, 0xFC, 0x8B, 0xCF, 0x50];
    const range2 = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr2 = L.findBytes(bytes2, L.processStartAddress, L.processStartAddress + range2);
    if (addr2) {
        return L.NewHook({
            address: addr2 + 2,
            type: L.CODEC_UTF16 | L.NO_CONTEXT | L.USING_STRING,
            offset: L.regoffset('eax'),
            filter_fun: WillPlus_extra_filter,
        }, 'WillPlus3_memcpy');
    }

    const bytes = [
        0x81, 0xec, 0x14, 0x08, 0x00, 0x00, // 0042B5E0   81EC 14080000    SUB ESP,0x814	; jichi: text in eax, name in eax - 1024, able to copy
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun: SpecialHookWillPlusA,
        type: L.NO_CONTEXT,
        filter_fun(buffer) { L.StringFilterA(buffer, '\\n'); },
    }, 'WillPlusA');
}

function SpecialHookWillPlusW(context, hp, buffer, split) {
    const text = context.ecx;
    if (!text || !L.u16(text)) return;
    const t = willplusTrim(text, true);
    split.value = (L.FIXED_SPLIT_VALUE << hp.user_value) >>> 0;
    buffer.from(t.text, t.size * 2);
}

function InsertWillPlusWHook() {
    const bytes1 = [
        // scenario
        0x83, 0xc0, 0x20, // 00452b02   83c0 20     add eax,0x20    ; jichi: hook before here, text in ecx
        0x33, 0xd2, // 00452b05   33d2        xor edx,edx
        0x8b, 0xc1, // 00452b07   8bc1        mov eax,ecx
        0xc7, 0x84, 0x24, 0xe0, 0x01, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, // 00452b09   c78424 e0010000 07000000      mov dword ptr ss:[esp+0x1e0],0x7
    ];
    const bytes2 = [
        // name
        0x33, 0xdb, // 00453521   33db                            xor ebx,ebx  ; jichi: hook here, text in ecx
        0x33, 0xd2, // 00453523   33d2                            xor edx,edx
        0x8b, 0xc1, // 00453525   8bc1                            mov eax,ecx
        0xc7, 0x84, 0x24, 0x88, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, // 00453527   c78424 88000000 07000000        mov dword ptr ss:[esp+0x88],0x7
    ];
    const bytes = [bytes1, bytes2];
    let succ = false;
    for (let i = 0; i < 2; i++) {
        const addr = L.findBytes(bytes[i], L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        succ = L.NewHook({
            address: addr,
            text_fun: SpecialHookWillPlusW,
            type: L.NO_CONTEXT | L.CODEC_UTF16,
            user_value: i,
            filter_fun(buffer) { L.StringFilterW(buffer, '\\n'); },
        }, 'WillPlusW') || succ;
    }
    return succ;
}

function InsertNewWillPlusHook() {
    let found = false;
    // hook cmp reg,0x3000
    const pattern = [
        0x81, XX, 0x00, 0x30, 0x00, 0x00, //    81FE 00300000  cmp esi,0x3000
        // or 81FB 00300000  cmp ebx,0x3000
        // or 81FF 00300000  cmp edi,0x3000
        //                   je xx
        //    8b4D A8        mov ecx,dword ptr ss:[ebp-??] hook here
        //    85C9           test ecx,ecx
    ];
    for (const addr of L.SearchMemory(pattern, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        if (L.u16(addr + 0xb) !== 0xC985) continue;

        const byte = L.u8(addr + 1);
        let offset = -1;
        switch (byte) {
            case 0xf9: offset = L.regoffset('ecx'); break;
            case 0xfa: offset = L.regoffset('edx'); break;
            case 0xfb: offset = L.regoffset('ebx'); break;
            case 0xfc: offset = L.regoffset('esp'); break;
            case 0xfd: offset = L.regoffset('ebp'); break;
            case 0xfe: offset = L.regoffset('esi'); break;
            case 0xff: offset = L.regoffset('edi'); break;
        }
        if (offset !== -1) {
            found = L.NewHook({ address: addr + 8, type: L.CODEC_UTF16, offset }, 'WillPlus3') || found;
        }
    }
    return found;
}

// InsertWillPlusHook(old = false): the old WillPlus1 hook is left out (see the top of the file)
function InsertWillPlusHook() {
    return InsertWillPlusWHook() || InsertNewWillPlusHook() || InsertWillPlusAHook();
}

// will3::hookBefore: the text at stack[hp.offset] (arg1 in the scenario hook); the hook-after is left out
function will3HookBefore(context, hp, buffer, split) {
    const text = context.stack[hp.offset];
    if (!text || !L.u16(text)) return;
    if (hp.offset === 7) split.value = context.stack[1];
    buffer.fromWCharPtr(text);
}

function InsertWillPlus4Hook() {
    // 星の乙女と六華の姉妹
    const bytes = [
        0xc7, 0x45, 0xfc, 0x00, 0x00, 0x00, 0x00,
        0x33, 0xc9,
        0xc7, 0x47, 0x78, 0x00, 0x00, 0x00, 0x00];
    // 宿りし乙女の誓いと魔法 -TRIAL EDITION-
    const bytes2 = [
        0xc7, 0x45, 0xfc, 0x00, 0x00, 0x00, 0x00,
        0X0F, 0X57, 0XC0,
        0xc7, 0x47, 0x78, 0x00, 0x00, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);

    if (!addr) addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;

    addr = L.findEnclosingFunctionBeforeDword(0x83dc8b53, addr, L.MaximumFunctionSize, 1);

    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: 7,
        filter_fun: WillPlus_extra_filter,
        lineSeparator: '\\n',
        type: L.USING_STRING | L.CODEC_UTF16,
        text_fun: will3HookBefore,
    }, 'EmbedWillplus3');
}

function InsertWillPlus5Hook() {
    // ensemble 29th Project『乙女の剣と秘めごとコンチェルト』オフィシャルサイト 体验版
    const bytes = [
        0x3d, ...XX2, 0x00, 0x00,
        0x72, XX,
        0x3d, ...XX2, 0x00, 0x00,
        0x77];
    // if (v26 >= 0xE63E) { if (v26 <= 0xE757)
    //   cmp eax, 0E63Eh / jb short / cmp eax, 0E757h / ja short
    let ok = false;
    for (const addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        ok = L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.CODEC_UTF16 }, 'WillPlus_extra2') || ok;
    }
    return ok;
}

function insertwillplus6() {
    // 想いを捧げる乙女のメロディー
    //   push 1 / push 0x55477c / xor eax,eax / mov edx,esi / call / cmp eax,-1 / jne  <- hook after it
    const bytes = [
        0x6a, 0x01,
        0x68, 0x7c, 0x47, 0x55, 0x00,
        0x33, 0xc0,
        0x8b, 0xd6,
        0xe8, ...XX4,
        0x83, 0xf8,
        0xff, 0x75, 0xdc];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);

    if (!addr) return false;
    addr += bytes.length;
    return L.NewHook({ address: addr, offset: L.stackoffset(6), type: L.CODEC_UTF16 | L.USING_STRING }, 'WillPlus6');
}

function willX() {
    // 世界でいちばんNGな恋: cmp esi, 8194h / 8474h / 8197h / 8190h / 8159h / 8196h
    const bytes = [
        0x81, 0xFE, 0x94, 0x81, 0x00, 0x00,
        0x74, XX,
        0x81, 0xFE, 0x74, 0x84, 0x00, 0x00,
        0x74, XX,
        0x81, 0xFE, 0x97, 0x81, 0x00, 0x00,
        0x74, XX,
        0x81, 0xFE, 0x90, 0x81, 0x00, 0x00,
        0x74, XX,
        0x81, 0xFE, 0x59, 0x81, 0x00, 0x00,
        0x74, XX,
        0x81, 0xFE, 0x96, 0x81, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);

    if (!addr) return false;
    let succ = L.NewHook({ address: addr, offset: L.regoffset('esi'), type: L.NO_CONTEXT | L.CODEC_ANSI_BE }, 'willAN');

    addr = L.findEnclosingAlignedFunction(addr);

    if (addr) {
        succ = L.NewHook({ address: addr, offset: L.stackoffset(7), type: L.USING_STRING }, 'willS') || succ;
    }
    return succ;
}

// TextHookW::attach<_type>: the text is the value at stack[stackIndex] (registers at negative indexes);
// embed_fun/hookafter/embed_hook_font are left out
function attachTextHookW(_type, bytes, startAddress, stopAddress, stackIndex) {
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun(s, hp, buffer) {
            const text = s.offset(stackIndex * 4);
            if (!text || !L.u16(text)) return;
            const size = L.wcslen(text);
            const t = trim(text, size, true);
            if (!t.size || !L.u16(t.text)) return;
            buffer.from(t.text, t.size * 2);
        },
        type: L.CODEC_UTF16 | L.NO_CONTEXT,
        lineSeparator: '\\n',
    }, 'EmbedWillplusW' + (0 + _type));
}

// Sample game: なついろレシピ (http://capita.tistory.com/m/post/251). Scenario: hook before the add eax,0x20, text in ecx
function attachScenarioHookW1(startAddress, stopAddress) {
    // ECX PTR: 83 C0 20 33 D2 8B C1 C7 84 24 E0 01 00 00 07 00 00 00
    const bytes = [
        0x83, 0xc0, 0x20, // 00452b02   83c0 20     add eax,0x20    ; jichi: hook before here, text in ecx
        0x33, 0xd2, // 00452b05   33d2        xor edx,edx
        0x8b, 0xc1, // 00452b07   8bc1        mov eax,ecx
        0xc7, 0x84, 0x24, 0xe0, 0x01, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, // 00452b09   c78424 e0010000 07000000      mov dword ptr ss:[esp+0x1e0],0x7
    ];
    const ecx = L.regoffset('ecx') / 4;
    return attachTextHookW(1, bytes, startAddress, stopAddress, ecx);
}

// 1/9/2016: 見上げてごらん、夜空の星を　体験版. Hook before mov eax,edi, text in edi
function attachScenarioHookW2(startAddress, stopAddress) {
    // key pattern: C78424 E0010000 07000000
    const bytes = [
        0x8b, 0xc7, // 00455833   8bc7                           mov eax,edi ; jichi: text in eax assigned from edi
        0xc7, 0x84, 0x24, 0xe0, 0x01, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, // 00455835   c78424 e0010000 07000000       mov dword ptr ss:[esp+0x1e0],0x7 ; jichi: key pattern is here, text i eax
    ];
    const edi = L.regoffset('edi') / 4;
    return attachTextHookW(2, bytes, startAddress, stopAddress, edi);
}

// Name: hook at the xor ebx,ebx, text in ecx
function attachNameHookW(startAddress, stopAddress) {
    // ECX PTR: 33 DB 33 D2 8B C1 C7 84 24 88 00 00 00 07 00 00 00
    const bytes = [
        0x33, 0xdb, // 00453521   33db                            xor ebx,ebx  ; jichi: hook here, text in ecx
        0x33, 0xd2, // 00453523   33d2                            xor edx,edx
        0x8b, 0xc1, // 00453525   8bc1                            mov eax,ecx
        0xc7, 0x84, 0x24, 0x88, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, // 00453527   c78424 88000000 07000000        mov dword ptr ss:[esp+0x88],0x7
    ];
    const ecx = L.regoffset('ecx') / 4;
    return attachTextHookW(3, bytes, startAddress, stopAddress, ecx);
}

// Choice: text in edx
function attachOtherHookW(startAddress, stopAddress) {
    // EDX PTR : 83 C0 10 52 8D 8C 24 7C 04 00 00 8D 74 24 4C
    const bytes = [
        0x83, 0xc0, 0x10, // 00470dbf   83c0 10                         add eax,0x10     ; jichi: text in edx
        0x52, // 00470dc2   52                              push edx
        0x8d, 0x8c, 0x24, 0x7c, 0x04, 0x00, 0x00, // 00470dc3   8d8c24 7c040000                 lea ecx,dword ptr ss:[esp+0x47c]
        0x8d, 0x74, 0x24, 0x4c, // 00470dca   8d7424 4c                       lea esi,dword ptr ss:[esp+0x4c]
    ];
    const edx = L.regoffset('edx') / 4;
    return attachTextHookW(4, bytes, startAddress, stopAddress, edx);
}

// PatchA::patchEncoding / replace_near_call (EMBED_DYNA_SJIS patching of the game's code) left out

// ScenarioHookA: [111028][PULLTOP] 神聖にして侵すべからず, Re:BIRTHDAY SONG. Scenario in eax, name in (eax - 1024)
function ScenarioHookAAttach(startAddress, stopAddress) {
    if (L.findiatcallormov(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStartAddress, L.processStopAddress)) return false;
    const bytes = [
        0x81, 0xec, 0x14, 0x08, 0x00, 0x00, // 0042B5E0   81EC 14080000    SUB ESP,0x814	; jichi: text in eax, name in eax - 1024, able to copy
    ];
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun(s, hp, buffer) {
            const text = s.eax;
            if (!text) return;
            // Engine::isAddressWritable(text): readable is what libLuna can check
            if (!L.isAddressReadable(text) || !L.u8(text)) return; // isAddressWritable is not needed for correct games
            const size = L.strlen(text);
            const t = trim(text, size, false);
            if (!t.size || !L.u8(t.text)) return;
            buffer.from(t.text, t.size);
        },
        type: L.NO_CONTEXT,
        lineSeparator: '\\n',
    }, 'EmbedWillplusA');
}

function OtherHookAAttach(startAddress, stopAddress) {
    const addr = L.findCallerAddressAfterInt3(L.FindFunction('GetGlyphOutlineA'), startAddress, stopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun(s, hp, buffer) {
            if (s.stack[1] === 3) return; // skip scenario hook where arg1 is 3
            const text = s.stack[8]; // text in arg8
            if (!L.isAddressReadable(text) || !L.u8(text) || L.strlen(text) <= 2) return; // do not translate single character
            buffer.fromCharPtr(text);
        },
        type: L.NO_CONTEXT,
        offset: L.stackoffset(8),
    }, 'EmbedWillplus_other');
}

// WillPlusEngine::attach
function WillPlusEngineAttach() {
    const startAddress = L.processStartAddress, stopAddress = L.processStopAddress;

    if (attachScenarioHookW1(startAddress, stopAddress) || attachScenarioHookW2(startAddress, stopAddress)) {
        attachNameHookW(startAddress, stopAddress);
        attachOtherHookW(startAddress, stopAddress);
        return true;
    } else if (ScenarioHookAAttach(startAddress, stopAddress)) { // try widechar pattern first, which is more unique
        OtherHookAAttach(startAddress, stopAddress);
        return true;
    }
    return false;
}

// InsertWillPlus5 (TextUnionW at ecx; pack 4: union { wchar_t *text; wchar_t chars[8]; }, size at 0x10, capacity at 0x14)
function InsertWillPlus5() {
    // Sample games: https://vndb.org/v29881
    const bytes = [
        0xE8, ...XX4, // call AdvHD.exe+38550   <-- hook here
        0x8B, 0x4B, 0x08, // mov ecx,[ebx+08]
        0x89, 0x8F, ...XX4, // mov [edi+0000014C],ecx
        0x85, 0xC9, // test ecx,ecx
        0x74, 0x04, // je AdvHD.exe+396C6
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    //[241227] [とこはな] エロ漫画お姉ちゃん！！ ～ダメダメな姉との甘々コスプレえっちな日々～
    addr = (addr + 5 + L.i32(addr + 1)) >>> 0;
    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF16 | L.USING_STRING | L.USING_SPLIT,
        text_fun(context, hp, buffer, split) {
            const p = context.ecx; // TextUnionW *
            buffer.from(L.u32(p + 0x14) < 8 ? p : L.u32(p), L.u32(p + 0x10) * 2);
            split.value = context.ebx;
        },
    }, 'WillPlus5');
}

function h7() {
    // v26 - 58942 <= 0x119 : the GetGlyphOutlineW wrapper's private-use range check
    const bytes = [
        0x8d, XX, 0xc2, 0x19, 0xff, 0xff, // lea ecx, [edi-0xe63e]
        0x81, XX, 0x19, 0x01, 0x00, 0x00, // cmp ecx,0x119
        0x77, XX, // ja xx
        ...XX4, // lea edx,[esp+34]
        XX, // push edx
        XX, 0xad, 0x8a, 0x00, 0x00, // mov edi,0x8aad
    ];
    // 宿りし乙女の誓いと魔法 -TRIAL EDITION-
    const bytes2 = [
        0x8d, XX, 0xc2, 0x19, 0xff, 0xff, // lea ecx, [edi-0xe63e]
        0x3d, 0x19, 0x01, 0x00, 0x00, // cmp ecx,0x119
        0x77, XX, // ja xx
        0x8b, 0x55, 0xb8,
        0xc7, 0x45, 0xbc, 0x18, 0xff, 0x00, 0x00,
        0x85, 0xd2,
        0x74, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    }
    if (!addr) return false;
    let offset = 0;
    switch (L.u8(addr + 1) & 0x7) {
        case 0x7: offset = L.regoffset('edi'); break;
        case 0x6: offset = L.regoffset('esi'); break;
        case 0x5: offset = L.regoffset('ebp'); break;
        case 0x3: offset = L.regoffset('ebx'); break;
        case 0x2: offset = L.regoffset('edx'); break;
        case 0x1: offset = L.regoffset('ecx'); break;
        case 0x0: offset = L.regoffset('eax'); break;
        default: return false;
    }
    return L.NewHook({ address: addr, offset, type: L.CODEC_UTF16 | L.USING_CHAR }, 'WillPlus7');
}

function willplus_1_9_9_15() {
    // のーぶるバトラー TRIAL EDITION
    const bytes = [
        0x8b, 0x45, XX,
        0x83, 0xf8, 0x0f,
        0x76, XX,
        0x8d, 0x48, 0x01,
        0x8b, 0xc6,
        0x81, 0xf9, 0x00, 0x10, 0x00, 0x00,
        0x72, XX,
        0x8b, 0x70, 0xfc,
        0x83, 0xc1, 0x23,
        0x2b, 0xc6,
        0x83, 0xc0, 0xfc,
        0x83, 0xf8, 0x1f,
        0x76, 0x06,
        0xff, 0x15, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr, // 0x4A1C50
        type: L.CODEC_UTF16 | L.USING_STRING,
        filter_fun: WillPlus_extra_filter,
        text_fun: will3HookBefore, // hp.offset stays 0 here, as in the C++
    }, 'WillPlus_1.9.9.15');
}

function h8() {
    // DYNAMIC CHORD feat.apple-polisher / Blackish House ←sideZ / Blackish House sideA→
    // sub_4B7040(void *Source <- ecx, ...)
    const bytes = [
        0x8d, 0x78, 0x01,
        0x8d, 0xa4, 0x24, 0x00, 0x00, 0x00, 0x00,
        0x8a, 0x10,
        0x40,
        0x84, 0xd2,
        0x75, 0xf9,
        0x2b, 0xc7,
        0x50,
        0x51,
        0x8d, 0x4c, 0x24, XX,
        0xe8, ...XX4,
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
        filter_fun: WillPlus_extra_filter,
    }, 'WillPlus.1.6.1.0');
}

const WillPlusETERNAL = L.engine({
    name: 'WillPlusETERNAL',
    // 銀の刻のコロナ
    check: () => L.SearchStringFileInfo('Will Plus/ETERNAL') && L.CheckFile('Data/Rio.arc'),
    attach() {
        // 銀の刻のコロナ
        if (L.findiatcallormov(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStartAddress, L.processStopAddress)) {
            L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineW'));
            return true;
        }
        return false;
    },
});

const WillPlus = L.engine({
    name: 'WillPlus',
    check: { FILE_ALL: ['Rio.arc', 'Chip*.arc'] },
    attach() {
        let succ = WillPlusEngineAttach();
        succ = InsertWillPlusHook() || succ;
        succ = (InsertWillPlus4Hook() || willplus_1_9_9_15()) || succ;
        succ = InsertWillPlus5Hook() || succ;
        succ = insertwillplus6() || succ;
        succ = willX() || succ; // willS conflicts with WillPlus1, e.g. Laughter Land https://vndb.org/v1076
        succ = InsertWillPlus5() || succ;
        return succ || h8() || h7();
    },
});

const Willold = L.engine({
    name: 'Willold',
    // https://vndb.org/v17755 凌辱鬼
    check: () => {
        let checkfile = L.CheckFileAll(['*.BIN', 'DATA\\*.ENV', 'DATA\\*.WBP']);
        if (checkfile) {
            checkfile = !!L.findBytes(L.aToBytes('Software\\WILL\\'), L.processStartAddress, L.processStopAddress);
        }
        return checkfile;
    },
    attach() {
        let addr = L.findLongJumpAddress(L.FindFunction('TextOutA'), L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findNearCallAddress(addr, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr, 0x200);
        if (!addr) return false;
        return L.NewHook({ address: addr, type: L.USING_CHAR | L.CODEC_ANSI_BE, offset: L.stackoffset(1) }, 'will');
    },
});

module.exports = [WillPlusETERNAL, WillPlus, Willold];
if (!module.parent) { L.run(WillPlusETERNAL); L.run(WillPlus); L.run(Willold); }
