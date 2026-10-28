// Sprite.js: LunaHook's Sprite engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Sprite.cpp and Sprite.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let TextXtra = 0;

function Sprite_attach_function() {
    // 恋と選挙とチョコレート
    const m = L.GetModuleHandle('dirapi.dll');
    const [minAddress, maxAddress] = L.QueryModuleLimits(m);
    const bytes = [
        0x83, 0xF8, 0x40,
        0x74, XX,
        0x83, 0xF8, 0x43,
        0x74, XX,
        0x83, XX, 0xFF,
        0xEB, XX,
        0x8D, 0x45, 0xF8,
        XX,
        XX,
        XX,
        //+20
        0xE8, ...XX4,
        0x89, 0x45, 0xF0,
        0x8D, 0x45, 0xF4,
        0x50,
        XX,
        0xE8, ...XX4];
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    if (((L.i32(addr + 22) + addr + 22) >>> 0) !== ((L.i32(addr + 35) + addr + 35) >>> 0)) return false;
    return L.NewHook({ address: addr + bytes.length, offset: L.regoffset('eax'), type: L.USING_STRING }, 'Sprite');
}

function _h1() {
    // https://vndb.org/v1714
    //[Selen]はらみこ
    const FlashAssetx32 = L.GetModuleHandleW('Flash Asset.x32');
    if (FlashAssetx32 === 0) return false;
    const [s, e] = L.QueryModuleLimits(FlashAssetx32);
    const bytes = [
        0x56, 0x57, 0x6a, 0xff,
        0xff, 0x75, 0x08, // ebp+8
        0x53,
        0x68, 0xe4, 0x04, 0x00, 0x00,
        0xff, 0x15, ...XX4, // MultiByteToWideChar
    ];
    const addr = L.findBytes(bytes, s, e);
    if (!addr) return false;
    let idx = 0; // static int idx
    return L.NewHook({
        address: addr + bytes.length, // 不知道从哪jump到call MultiByteToWideChar的
        offset: L.stackoffset(5),
        type: L.USING_STRING,
        filter_fun(buffer) {
            if ((idx++) % 2) buffer.clear();
        },
    }, 'Flash Asset');
}

function h5() {
    // https://vndb.org/v2444
    // Deep Fantasy
    let m = L.GetModuleHandle('iml32.dll');
    if (!m) return false;
    const IML32_1114 = L.GetProcAddress(m, 1114); // by ordinal
    if (!IML32_1114) return false;
    m = L.GetModuleHandle('dirapi.dll');
    const [minAddress, maxAddress] = L.QueryModuleLimits(m);
    const bytes = [
        0x8B, 0xBC, 0x24, 0x18, 0x01, 0x00, 0x00,
        0x85, 0XFF,
        0X0F, 0X8C, ...XX4,
        0X8B, 0XAC, 0X24, 0X14, 0X01, 0X00, 0X00,
        0X8B, 0X55, 0X04,
        0X2B, 0XD7,
        0X85, 0XD2,
        0X0F, 0X8E, ...XX4,
        0X8B, 0X45, 0X00,
        0X85, 0XC0,
        0X0F, 0X84, ...XX4,
        0X50,
        0XE8, ...XX4, // call    IML32_1114
    ];
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    let last = ''; // static std::string last
    return L.NewHook({
        address: addr + bytes.length,
        type: L.USING_STRING,
        offset: L.regoffset('eax'),
        filter_fun(buffer) {
            const s = buffer.strA();
            if (s === last) return buffer.clear();
            last = s;
        },
    }, 'dirapi');
}

function _h2(s, e) {
    const bytes = [
        0xff, 0x75, 0x18,
        0x8d, 0x88, 0xb8, 0x00, 0x00, 0x00,
        0xff, 0x75, 0x14,
        0xff, 0x75, 0x10,
        0xff, 0x75, 0x0c,
        0xe8, ...XX4,
        0x66, 0x85, 0xc0,
        0x74];
    let addr = L.findBytes(bytes, s, e);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x100);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING | L.CODEC_UTF8 }, 'TextXtra');
}

function h3(s, e) {
    // https://vndb.org/v5864
    // in white
    // Text Asset.x32->this function
    const bytes = [
        0x55, 0x8b, 0xec,
        0x56,
        0x8b, 0x75, 0x08,
        0x8b, 0x46, 0x04,
        0x66, 0x8b, 0x48, 0x32,
        0x51,
        0x6a, 0x00,
        0xff, 0x75, 0x18,
        0xff, 0x75, 0x14,
        0xff, 0x75, 0x10,
        0xff, 0x75, 0x0c,
        0xff, 0x70, 0x24,
        0xe8, ...XX4,
        0x66, 0x85, 0xc0,
        0x74, XX];
    const addr = L.findBytes(bytes, s, e);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'TextXtra2');
}

const E = L.engine({
    name: 'Sprite',
    check: () => !!(TextXtra = L.GetModuleHandle('TextXtra.x32')) || L.CheckFile('*.cct'),
    files: ['*.cct'],
    certain: false,
    attach() {
        const a = Sprite_attach_function();
        const b = _h1(); // `|`: both run
        let succ = (a || b) || h5();
        if (TextXtra) {
            const [s, e] = L.QueryModuleLimits(TextXtra);
            succ = (_h2(s, e) || h3(s, e)) || succ;
        }
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
