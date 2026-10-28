// CodeX.js: LunaHook's CodeX engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CodeX.cpp and CodeX.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function CodeXFilter(buffer) {
    let result = buffer.strA();
    result = L.strReplace(result, '^n', '\n');
    if (result.startsWith('\n'))
        result = result.substr(1);

    //|晒[さら]
    result = L.re.sub(result, '\\|(.+?)\\[(.+?)\\]', '$1');
    buffer.fromA(result);
}

function InsertCodeXHook() {
    // Sample games: https://vndb.org/v41664, https://vndb.org/v36122
    const bytes = [
        0x83, 0xC4, 0x08, // add esp,08                  << hook here
        0x8D, 0x85, ...XX4, // lea eax,[ebp-00000218]
        0x50, // push eax
        0x68, ...XX4, // push ???????????!.exe+10A76C
        0x85, 0xF6, // test esi,esi
        0x74, 0x4F, // je ???????????!.exe+2A95B
        0xFF, 0x15, ...XX4, // call dword ptr [???????????!.exe+C8140]
        0x8B, 0x85, ...XX4]; // mov eax,[ebp-00000220]      << alternative hook here

    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }

    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        index: 0,
        type: L.USING_STRING | L.NO_CONTEXT, // 无法解决中文乱码
        filter_fun: CodeXFilter,
    }, 'CodeX');
}

function hook() {
    // 霞外籠逗留記
    const _ = [0x90, 0x90, 0x68, 0x64, 0x7B, 0x4C, 0x00]; // aHdL db 'hd{L',0
    let addr = L.findBytes(_, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr += 2;
    const bytes = [0x68, ...L.le32(addr)];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (let adr of addrs) {
        adr = L.findEnclosingAlignedFunction(adr);
        if (adr === 0)
            continue;
        succ = L.NewHook({ address: adr, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'CodeX') || succ;
    }
    return succ;
}

// https://vndb.org/v598
// ANGEL BULLET
function hook2() {
    const _ = [
        0x8b, 0x44, 0x24, 0x04,
        0x81, 0xec, ...XX4,
        0x25, 0xff, 0xff, 0, 0,
        0x8d, 0x54, 0x24, 0,
        0x56,
        0x8b, 0xf1,
        0x50,
        0x8d, 0x4e, XX,
        0x51,
        0x68, ...XX4, //%s%03d
        0x52,
        0xff, 0x15, ...XX4]; // wprintfA
    const addr = L.findBytes(_, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.USING_STRING, filter_fun: CodeXFilter }, 'CodeX');
}

function hook3() {
    const _ = [
        // if ( *(_WORD *)v38 == 8511 || (_WORD)v5 == 16161 || (_WORD)v5 == 8481 )
        0xB9, 0x3F, 0x21, 0x00, 0x00, // mov     ecx, 213Fh
        0x0F, 0xB7, 0x02, // movzx   eax, word ptr [edx]
        0x66, 0x3B, 0xC1, // cmp     ax, cx
        0x0F, 0x84, ...XX4, // jz      loc_458294
        0xb9, 0x21, 0x3f, 0x00, 0x00, // mov     ecx, 3F21h
        0x66, 0x3B, 0xC1,
        0x0F, 0x84, ...XX4,
        0xb9, 0x21, 0x21, 0x00, 0x00, // mov     ecx, 2121h
        0x66, 0x3B, 0xC1,
        0x0F, 0x84, ...XX4];
    let addr = L.findBytes(_, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.stackoffset(2),
        type: L.USING_STRING | L.NO_CONTEXT | L.USING_SPLIT,
        filter_fun: CodeXFilter,
    }, 'CodeX2');
}

//[160930] [ライアーソフト] 大迷宮＆大迷惑 -GREAT EDGES IN THE ABYSS-
// (sub_459EC0: the string loop with _ismbblead / _ismbbtrail and the 8511 / 16161 / 8481 checks)
function h4() {
    const _ = [
        0x8b, 0x84, 0x24, ...XX4,
        0x66, 0x8b, 0x08,
        0x66, 0x81, 0xf9, 0x3f, 0x21,
        0x0f, 0x84, ...XX4,
        0x66, 0x81, 0xf9, 0x21, 0x3f,
        0x0f, 0x84, ...XX4,
        0x66, 0x81, 0xf9, 0x21, 0x21,
        0x0f, 0x84, ...XX4,
        0x80, 0xf9, 0x7c];
    const addr = L.findBytes(_, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    const faddr = L.findEnclosingAlignedFunction(addr);
    if (!faddr)
        return false;
    const bytes2 = [
        0x8a, 0x00,
        0x84, 0xc0,
        0x0f, 0x84, ...XX4,
        0x0f, 0xbe, 0xc8,
        0x51,
        0xe8, ...XX4, // call    __ismbblead
        0x83, 0xc4, 0x04,
        0x85, 0xc0,
        0x0f, 0x84, ...XX4,
        0x8b, 0x94, 0x24, ...XX4,
        0x0f, 0xbe, 0x42, 0x01,
        0x50,
        0xe8, ...XX4]; // call    __ismbbtrail
    const addrX = L.findBytes(bytes2, faddr, addr);
    if (!addrX)
        return false;
    // __ismbblead / __ismbbtrail (the call targets) are only used by LunaHook's patch_fun_ptrs, which
    // replaces them so '^' is no lead byte while embedding: left out.
    return L.NewHook({
        address: faddr,
        offset: L.stackoffset(1),
        split: L.stackoffset(1),
        type: L.USING_STRING | L.USING_SPLIT,
        filter_fun(buffer) {
            // 这个东西^开头的都是各种奇葩控制符。懒得管了。
            let result = buffer.strAW();
            result = L.re.sub(result, String.raw`\|(.*?)\[(.*?)\]`, '$1');
            result = L.re.sub(result, String.raw`\^d\d`);
            // 内嵌会导致^\w解析错误
            //^n ^m ...
            result = L.re.sub(result, String.raw`\^\w`);
            buffer.fromWA(result);
        },
    }, 'CodeX');
}

const E = L.engine({
    name: 'CodeX',
    check: { FILE: '*.xfl' },
    certain: false,
    attach() {
        L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineA')); // 对于部分游戏，文本分两段显示，会吞掉后半段。故此用这个兜底
        const h3 = hook3();
        const x = InsertCodeXHook();
        return (h3 || x) || h4() || hook() || hook2();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
