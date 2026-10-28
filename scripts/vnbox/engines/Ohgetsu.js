// Ohgetsu.js: LunaHook's Ohgetsu engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Ohgetsu.cpp and Ohgetsu.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font of _4; _5 (hp.type = DIRECT_READ, read codes are not supported).
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function hook1() {
    // Silvery White ～君と出逢った理由～
    const bytes = [
        0x8b, XX, 0x10,
        0x8b, XX, 0x0C,
        0x8b, XX, 0x08,
        0x8b, XX,
        0xc1, XX, 0x02,
        0xf3, 0xa5,
        0x8b, XX,
        0x83, XX, 0x03,
        0xf3, 0xa4,
        0x8b, XX, 0x08,
        0x03, XX, 0x10,
        0xC6, XX, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            const text = context.stack[2];
            const size = context.stack[3];
            split.value = context.stack[0];
            buffer.from(text, size);
        },
    }, 'Ohgetsu');
}

function hook2() {
    // Palmyra ～熱砂の海と美なる戦姫～
    const bytes = [
        0x8b,
        XX,
        0x08,
        0x0f,
        XX,
        0x08,
        0xC1,
        XX,
        0x08,
        0x8b,
        XX,
        0x08,
        0x0f,
        0xb6,
        0x42,
        0x01,
        0x0b,
        XX,
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            split.value = context.stack[0];
            buffer.from(context.stack[1], context.stack[2]);
        },
    }, 'Ohgetsu');
}

function _3() {
    // それは舞い散る桜のように FullEffect
    const addr = L.findCallerAddress(L.FindFunction('GetGlyphOutlineA'), 0xec81, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // reladdr = 0x48ff0;
    // reladdr = 0x48ff3;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'Basil');
}

function _4() {
    // それは舞い散る桜のように FullEffect
    const bytes = [
        0x3D,
        0x00,
        0x02,
        0xFF,
        0xFF,
        ...XX2,
        0x3D,
        0x01,
        0x02,
        0xFF,
        0xFF,
        ...XX2,
        0x3D,
        0x02,
        0x02,
        0xFF,
        0xFF,
        ...XX2,
    ];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'Basil2');
}

function _6() {
    // 仰せのままに★ご主人様！
    // 这个有人名，上面那个只有文本
    const bytes = [
        0x6a, 0x46,
        0x8b, 0x4d, 0xf4,
        0x6b, 0xc9, 0x46,
        0x81, 0xc1, ...XX4,
        0x51,
        0x8b, 0x55, 0xf4,
        0x83, 0xea, 0x05,
        0x6b, 0xd2, 0x46,
        0x81, 0xc2, ...XX4,
        0x52,
        0xe8];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        length_offset: 2,
        offset: L.stackoffset(1),
        filter_fun(buffer) {
            L.StringCharReplacerA(buffer, '||', '\n');
        },
    }, 'Ohgetsu');
}

function _7() {
    return _6(); // || _5(), which is a DIRECT_READ hook (not ported)
}

function h8() {
    // V.G. Re-birth
    // https://vndb.org/v6556
    const bytes = [
        0x53, 0x56, 0x57, 0x68, 0x04, 0x04, 0x00, 0x00, 0xE8, 0xAE, 0x11, 0x01, 0x00, 0x8B, 0x7C, 0x24,
        0x18, 0x8B, 0xD0, 0x8B, 0x44, 0x24, 0x14, 0x83, 0xC9, 0xFF, 0x89, 0x02, 0x33, 0xC0, 0x83, 0xC4,
        0x04, 0x8D, 0x5A, 0x04, 0xF2, 0xAE, 0xF7, 0xD1, 0x2B, 0xF9, 0x52, 0x8B, 0xC1, 0x8B, 0xF7, 0x8B,
        0xFB, 0xC1, 0xE9, 0x02, 0xF3, 0xA5, 0x8B, 0xC8, 0x83, 0xE1, 0x03, 0xF3, 0xA4, 0x8B, 0x0D, 0x94,
        0x0D, 0x44, 0x00, 0xE8, 0x08, 0x13, 0x00, 0x00, 0x8B, 0x0D, 0x94, 0x0D, 0x44, 0x00, 0x5F, 0x5E,
        0x5B, 0x83, 0x79, 0x14, 0x64, 0x7E, 0x1D, 0xE8, 0xA4, 0x14, 0x00, 0x00, 0x85, 0xC0, 0x74, 0x09,
        0x50, 0xE8, 0x4A, 0x11, 0x01, 0x00, 0x83, 0xC4, 0x04, 0x8B, 0x0D, 0x94, 0x0D, 0x44, 0x00, 0xE9,
        0x3C, 0x13, 0x00, 0x00, 0xC3,
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.FULL_STRING,
        offset: L.stackoffset(2),
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`@v\d+`);
            buffer.fromA(s);
        },
    }, 'Ohgetsu');
}

function aquablue() {
    // AQUA BLUE
    // https://vndb.org/v4445
    const bytes = [
        0x8b, 0x45, 0x60,
        0x8b, 0x75, 0x58,
        0x03, 0xc6,
        0x8a, 0x08,
        0x84, 0xc9,
        0x0f, 0x84, ...XX4,
        0x80, 0xf9, 0x40,
        0x0f, 0x85, ...XX4,
        0x0f, 0xbe, 0x48, 0x01,
        0x83, 0xc1, 0x9a,
        0x83, 0xf9, 0x10,
        0x0f, 0x87, ...XX4,
        0x33, 0xd2,
        0x8a, 0x91, ...XX4,
        0xff, 0x24, 0x95, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    let save = ''; // static std::string save
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.FULL_STRING,
        text_fun(context, hp, buffer) {
            const ptr = L.u32(context.argof_thiscall(0) + 88);
            buffer.fromCharPtr(ptr);
        },
        filter_fun(buffer) {
            let s = buffer.strA();
            if (s.startsWith('@v')) {
                save = L.re.sub(s, String.raw`@v\d+`);
                return buffer.clear();
            }
            s = s + save;
            save = '';
            buffer.fromA(s);
        },
    }, 'aquablue');
}

const E = L.engine({
    name: 'Ohgetsu',
    // それは舞い散る桜のように FullEffect
    check: { FILE_ALL: ['script.pac', 'se.pac', 'visual.pac', 'voice*.pac'] }, // ,'music.pac','mov00001.mpg'
    certain: false,
    attach() { return hook1() || hook2() || _7() || _3() || _4() || h8() || aquablue(); },
});

module.exports = E;
if (!module.parent) L.run(E);
