// CatSystem.js: LunaHook's CatSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CatSystem.cpp and CatSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// jichi 5/10/2014. See the sample stacks of the old engine (グリザイアの迷宮) and the new engine
// (イノセントガール) in CatSystem.cpp: the character is in arg2.
// SpecialHookCatSystem3 (unused in LunaHook) and the Patch namespace (dynamic SJIS lead byte patch,
// embedding only) are left out.

function InsertCatSystemHook() {
    const beg = 0xff6acccc; // jichi 7/12/2014: beginning of the function
    const addr_offset = 2; // skip two leading 0xcc
    const addr = L.findCallerAddress(L.FindFunction('GetTextMetricsA'), beg, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;

    const hp = {};
    hp.address = addr + addr_offset;
    hp.type = L.CODEC_ANSI_BE;

    const newEngine = L.CheckFile('cs2conf.dll');
    if (newEngine) {
        hp.offset = L.stackoffset(2);
        hp.type |= L.USING_SPLIT;
        hp.split = L.regoffset('esi');
    } else {
        const check3 = [0X6A, 0XFF,
            0X68, ...XX4,
            0X64, 0XA1, 0, 0, 0, 0,
            0X50,
            0X64, 0X89, 0x25, 0, 0, 0, 0,
            0x81, 0xec, ...XX4,
            0XA1, ...XX4,
            0x55,
            0x56,
            0X89, 0X84, 0X24, ...XX4,
            0x57,
            0x8b, 0xf1,
            0X8D, 0X44, 0X24, XX,
            0x50,
            0X8D, 0X4c, 0X24, XX,
            0x51,
            0X8B, XX,
            0xe8, ...XX4,
            0x8b, XX, 0x24, ...XX4,
            0x66, 0x3b, 0x6e, 0x14,
            0x8b, XX, 0x24, ...XX4];
        const check = [0x66, 0x83, 0xff, 0x20, // 0x20
            0x0f, 0x84, ...XX4,
            0xb8, 0x40, 0x81, 0x00, 0x00, // 0x8140
            0x66, 0x3b, 0xf8];
        const check_1 = [
            // ちょっと素直にどんぶり感情
            0x66, 0x83, 0xfe, 0x20, // 0x20
            0x0f, 0x84, ...XX4,
            0x66, 0x81, 0xfe, 0x40, 0x81, // 0x8140
            0x0f, 0x84, ...XX4,
            0X8B, 0X4F, 0X08];
        const check2 = [
            0X6A, 0XFF,
            0X68, ...XX4,
            0X64, 0XA1, 0, 0, 0, 0,
            0X50,
            0X81, 0XEC, ...XX4,
            0XA1, ...XX4,
            0X33, 0XC4,
            0X89, 0X84, 0X24, ...XX4,
            XX, XX, XX,
            0XA1, ...XX4,
            0X33, 0XC4,
            XX,
            0X8D, 0X84, 0X24, ...XX4,
            0X64, 0XA3, 0, 0, 0, 0,
            0X8B, 0XF9];
        if (L.findBytes(check, addr, addr + 0x100)) {
            hp.split = L.stackoffset(1);
            hp.offset = L.regoffset('edx');
            hp.type |= L.USING_SPLIT;
        } else if (L.MatchPattern(hp.address, check2)) {
            // 結い橋R
            // https://vndb.org/v5588
            hp.offset = L.regoffset('ecx');
            // hp.split = stackoffset(1);
        } else if (L.findBytes(check_1, addr, addr + 0x700)) {
            hp.offset = L.stackoffset(1);
        } else if (L.MatchPattern(hp.address, check3)) {
            // 魔法とHのカンケイ。
            // https://vndb.org/v1809
            hp.offset = L.stackoffset(1);
            hp.type |= L.USING_SPLIT;
            hp.split = L.regoffset('ecx');
        } else {
            hp.offset = L.stackoffset(2);
            hp.split = L.regoffset('edx');
            hp.type |= L.USING_SPLIT;
        }
    }
    return L.NewHook(hp, 'CatSystem2');
}

function InsertCatSystem2Hook() {
    // Sample games: https://vndb.org/v26987
    const bytes = [
        0x38, 0x08, // cmp [eax],cl
        0x0F, 0x84, ...XX4, // je cs2.exe+23E490
        0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, ...XX4, // nop word ptr [eax+eax+00000000]
        0x4F, // dec edi
        0xC7, 0x85, ...XX4, ...XX4, // mov [ebp-000005A0],00000000
        0x33, 0xF6, // xor esi,esi
        0xC7, 0x85, ...XX4, ...XX4, // mov [ebp-0000057C],00000000
        0x85, 0xFF]; // test edi,edi

    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr)
        return false;

    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun(buffer) {
            let _ = L.re.sub(buffer.strA(), String.raw`\[(.+?)/.+\]`, '$1');
            _ = L.strReplace(_, '\\@');
            buffer.fromA(_);
        },
        lineSeparator: '\\n',
    }, 'CatSystem2new');
}

// Remove leading spaces, \command prefixes and ascii (not "[", needed for ruby); returns the start index.
function ltrim(s) {
    const c = (i) => (i < s.length ? s.charCodeAt(i) : 0);
    let t = 0;
    let lastText = -1;
    while (c(t) && t !== lastText) {
        lastText = t;
        if (c(t) === 0x20)
            t++;
        if (c(t) === 0x81 && c(t + 1) === 0x40) // skip space 　 (0x8140 in sjis)
            t += 2;
        if (c(t) === 0x5c) { // '\\'
            t++;
            while ((c(t) >= 0x61 && c(t) <= 0x7a) || c(t) === 0x40) // islower or '@'
                t++;
        }
    }
    while (c(t) > 0 && c(t) < 0x80 && c(t) !== 0x5b) // skip all leading ascii characters except "[" needed for ruby
        t++;
    return t;
}

// Remove trailing '\@'
function rtrim(s) {
    let size = s.length;
    while (size >= 2 && s.charCodeAt(size - 2) === 0x5c && s.charCodeAt(size - 1) <= 127)
        size -= 2;
    return size;
}

// ScenarioHook (EmbedCS2): the text is read before the engine's own text function runs; the embed part
// (hookafter, patchEncoding, roles, embed_hook_font) is left out. The role guess (minimumGroupId_, names,
// choices) only sets Engine::…Role, so it is left out too.
function ScenarioHookAttach(startAddress, stopAddress, utf8) {
    const bytes = [
        0xe8, ...XX4, // 004b00dc   e8 7f191300      call .005e1a60 ; jichi: hook after here
        0xbe, ...XX4, // 004b00e1   be d0e87b00      mov esi,.007be8d0
        0x8b, 0xc8, // 004b00e6   8bc8             mov ecx,eax
        0x2b, 0xf0]; // 004b00e8   2bf0             sub esi,eax
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr)
        return false;
    const hp = {};
    hp.address = addr + 5;
    hp.type = L.USING_STRING | L.NO_CONTEXT;
    if (utf8)
        hp.type |= L.CODEC_UTF8;
    hp.text_fun = (s, hp, buffer) => {
        const text = s.eax; // arg1
        if (!text || !L.u8(text)) return;
        const str = L.readA(text);
        if (L.all_ascii(str)) return;
        const start = ltrim(str);
        if (start >= str.length) return;
        const trimmedSize = rtrim(str.substr(start));
        buffer.fromA(L.strReplace(str.substr(start, trimmedSize), '\\n', '\n'));
    };
    hp.filter_fun = (buffer) => {
        buffer.fromA(L.re.sub(buffer.strA(), String.raw`\[(.+?)/.+\]`, '$1'));
    };

    return L.NewHook(hp, 'EmbedCS2');
}

function cs2() {
    // https://vndb.org/v26537
    const bytes = [
        // cmp bx, 20h / mov ecx, 8140h / cmp bx, cx  ... if ( a9 ) { a3 == 32 || a3 == 12288 } else { a3 == 32 || a3 == 0x8140 }
        0x66, 0x83, 0xfb, 0x20,
        0x0f, 0x84, ...XX4,
        0xB9, 0x40, 0x81, 0x00, 0x00,
        0x66, 0x3B, 0xD9,
        0x75, XX,

        0xe9, ...XX4,

        0x66, 0x83, 0xfb, 0x20,
        0x0f, 0x84, ...XX4,
        0xB9, 0x00, 0x30, 0x00, 0x00,
        0x66, 0x3B, 0xD9,
        0x0f, 0x84, ...XX4];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR,
        text_fun(context, hp, buffer) {
            if (context.stack[8]) {
                hp.type |= L.CODEC_UTF16;
                hp.type &= ~L.CODEC_ANSI_BE;
            } else {
                hp.type |= L.CODEC_ANSI_BE;
                hp.type &= ~L.CODEC_UTF16;
            }
            const c = context.stack[2];
            buffer.from_t(c, 2);
        },
    }, 'catsystem');
}

const E = L.engine({
    name: 'CatSystem',
    check: { FILE: '*.int' },
    certain: false,
    attach() {
        let utf8 = false;
        let b1 = InsertCatSystemHook();
        if (!b1) {
            b1 = InsertCatSystem2Hook() || b1;
            utf8 = true;
        }
        const embed = ScenarioHookAttach(L.processStartAddress, L.processStopAddress, utf8);
        b1 = b1 || cs2();
        b1 = embed || b1;
        return b1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
