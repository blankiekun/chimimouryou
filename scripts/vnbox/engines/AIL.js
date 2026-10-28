// AIL.js: LunaHook's AIL engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AIL.cpp and AIL.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertAIL2Hook() {
    const bytes1 = [
        // cmp al, 66h; jz; cmp al, 70h; jz; cmp al, 73h; jz
        0x3c, 0x66,
        0x74, XX,
        0x3c, 0x70,
        0x74, XX,
        0x3c, 0x73,
        0x74, XX];
    let addr1 = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress);
    if (!addr1) return false;
    const pattern = [0x90, 0x90, 0x83, 0xec];
    addr1 = L.reverseFindBytes(pattern, L.processStartAddress, addr1, 2);
    if (!addr1) return false;
    return L.NewHook({ address: addr1, codepage: 932, offset: L.stackoffset(3), type: L.USING_STRING }, 'AIL1');
}

function h2() {
    const bytes = [ // if ( v12 != 32 && v12 != 33088 )
        0x3d, 0x40, 0x81, 0x00, 0x00, XX]; // 00 or 0f
    const addr1 = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr1) return false;
    let addr2 = L.findEnclosingAlignedFunction(addr1);
    const CHECKOK = [
        // 桃華散る～少女剣士の報復は慟哭に満ちて～
        // https://vndb.org/v2586
        0x8b, 0x45, XX, 0x03, 0xc8];
    if (addr2 && L.MatchPattern(addr2 - 1, CHECKOK)) addr2 = 0;
    if (!addr2) addr2 = L.findfuncstart(addr1, 0xA0);
    if (addr2) {
        return L.NewHook({
            address: addr2,
            codepage: 932,
            offset: L.stackoffset(4),
            type: L.USING_STRING | L.USING_SPLIT, // 注音
            split_index: 0,
        }, 'AIL2');
    }
    return L.NewHook({
        address: addr1,
        codepage: 932,
        offset: L.regoffset('eax'),
        type: L.USING_CHAR | L.CODEC_ANSI_BE,
    }, 'AIL3');
}

function AILold() {
    // https://vndb.org/v6409
    //  エルフィーナ～淫夜へと売られた王国で…～
    // 其实这个同一个函数里面也有 cmp     al, 66h; 'f'这个pattern，不过不太一样。懒得分了就这样吧。
    const bytes1 = [
        // mov edx, [esp+3Ch+lpString]; mov dl, [edi+edx]; movsx esi, dl; cmp esi, 40h; ja def; xor ebx, ebx;
        // mov bl, ds:byte_43270C[esi]; jmp ds:jpt_431EB0[ebx*4]
        0x8b, 0x54, 0x24, XX,
        0x8a, 0x14, 0x17,
        0x0f, 0xbe, 0xf2,
        0x83, 0xfe, 0x40,
        0x0f, 0x87, ...XX4,
        0x33, 0xdb,
        0x8a, 0x9e, ...XX4,
        0xff, 0x24, 0x9d, ...XX4];
    let addr1 = L.findBytes(bytes1, L.processStartAddress, L.processStopAddress);
    if (!addr1) return false;
    addr1 = L.findEnclosingAlignedFunction(addr1);
    if (!addr1) return false;
    // embed flags and embed_hook_font left out (translation embedding)
    return L.NewHook({ address: addr1, offset: L.stackoffset(3), type: L.USING_STRING }, 'AIL');
}

const E = L.engine({
    name: 'AIL',
    check: () => L.CheckFileAll(['*.wa', 'Gall*.da', 'Pall*.da', 'vall*.da', 'sall.sn', 'help/*.ht']) ||
        L.CheckFile('Gall*.dat'),
    attach() {
        // C++ `|` runs all three hooks
        const a = InsertAIL2Hook();
        const b = h2();
        return AILold() || a || b;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
