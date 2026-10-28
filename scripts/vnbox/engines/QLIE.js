// QLIE.js: LunaHook's QLIE engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/QLIE.cpp and QLIE.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX2, XX4 } = L;
const MAX_REL_ADDR = 0x00300000;

/**
 * Artikash 8/1/2018: new QLIE hook. old one misses on https://vndb.org/v22308 and https://vndb.org/v19182
 * ExtTextOut hook misses characters because of font caching
 * characterizing pattern:
 * kimimeza.exe+100D9C - 55                    - push ebp
 * kimimeza.exe+100D9D - 8B EC                 - mov ebp,esp
 * kimimeza.exe+100D9F - 83 C4 E4              - add esp,-1C { 228 }
 */
function InsertQLIE3Hook() {
    const bytes = [
        0x55,
        0x8b, 0xec,
        0x83, 0xc4, 0xe4,
        0x53,
        0x56,
        0x57,
        0x33, 0xd2,
        0x89, 0x55, 0xfc];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        type: L.CODEC_UTF16 | L.DATA_INDIRECT | L.USING_SPLIT,
        offset: L.regoffset('esi'),
        split: L.regoffset('edi'),
        address: addr,
    }, 'QLiE3');
}

/**
 * jichi 8/18/2013: new QLIE hook. 55 8B EC 53 8B 5D 1C, hook at the push ebp (/HBN14*0@4CC2C4, type 0x408).
 */
function InsertQLIE2Hook() {
    const bytes = [
        0x55, // push ebp    ; hook here
        0x8b, 0xec, // mov ebp, esp
        0x53, // push ebx
        0x8b, 0x5d, 0x1c, // mov ebx, dword ptr ss:[ebp+1c]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        type: L.DATA_INDIRECT | L.NO_CONTEXT, // 0x408
        offset: L.stackoffset(5),
        address: addr,
    }, 'QLiE2');
}

// jichi: 8/18/2013: Change return type to bool
function InsertQLIE1Hook() {
    const { bytes: b, base } = L.region(L.processStartAddress + 0x1000, L.processStopAddress - 4);
    for (let k = 0; k + 3 < b.length; k++) {
        // *(DWORD *)i == 0x7ffe8347: inc edi, cmp esi,7f
        if (!(b[k] === 0x47 && b[k + 1] === 0x83 && b[k + 2] === 0xfe && b[k + 3] === 0x7f)) continue;
        const i = base + k;
        let t = 0;
        for (let j = i; j < i + 0x10; j++) {
            if (L.u32(j) === 0xa0) { // cmp esi,a0
                t = 1;
                break;
            }
        }
        if (t) {
            for (let j = i; j > i - 0x100; j--) {
                if (L.u32(j) === 0x83ec8b55) { // push ebp, mov ebp,esp, sub esp,*
                    return L.NewHook({
                        address: j,
                        text_fun(context, hp, buffer, split) {
                            let addr = context.stack[6];
                            if (L.IsBadReadPtr(addr, 2)) {
                                // https://vndb.org/v571
                                // きみはぐ
                                addr = context.stack[7];
                            } else {
                                split.value = context.esp;
                            }
                            buffer.from_t(L.u16(addr), 2);
                        },
                    }, 'QLiE');
                }
            }
        }
    }
    return false;
}

function _4() {
    // シスターシスター
    // https://vndb.org/v653
    const bytes = [
        0x81, 0xFB, 0x80, 0x00, 0x00, 0x00,
        ...XX2,
        0x81, 0xFB, 0xa0, 0x00, 0x00, 0x00,
        ...XX2,
        0x81, 0xFB, 0xdf, 0x00, 0x00, 0x00,
        ...XX2,
        0x81, 0xFB, 0xff, 0x00, 0x00, 0x00,
        ...XX2];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const funcstart = [0x90, 0x55, 0x8b, 0xec];
    addr = L.reverseFindBytes(funcstart, addr - 0x100, addr);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.stackoffset(6), type: L.USING_STRING }, 'QLIE4');
}

function _5() {
    // おしかけおさなづま3(3乗）
    // School Festa－スクールフェスタ－
    const bytes = [
        0x83, 0xFF, 0x7F,
        ...XX2,
        0x81, 0xFf, 0xa0, 0x00, 0x00, 0x00,
        ...XX2,
        0x81, 0xFf, 0xdf, 0x00, 0x00, 0x00,
        ...XX2,
        0x81, 0xFf, 0xff, 0x00, 0x00, 0x00,
        ...XX2];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('ecx'), type: L.USING_STRING }, 'QLIE5');
}

//(18禁ゲーム) [240426] [ωstar] 美少女万華鏡異聞 雪おんな
function qlie4() {
    const bytes = [
        0x55, 0x8b, 0xec,
        0x83, 0xc4, 0xe8,
        0x53, 0x56, 0x57,
        0x33, 0xdb,
        0x89, 0x5d, 0xe8,
        0x89, 0x5d, 0xf8,
        0x89, 0x4d, 0xf0,
        0x89, 0x55, 0xfc,
        0x8b, 0x45, 0xfc,
        0xe8, ...XX4,
        0x33, 0xc0,
        0x55,
        0x68, ...XX4,
        0x64, 0xff, 0x30,
        0x64, 0x89, 0x20,
        0x33, 0xf6,
        0x8d, 0x45, 0xf8,
        0x33, 0xd2,
        0xe8, ...XX4,
        0x8b, 0x45, 0xfc,
        0x85, 0xc0,
        0x74, L.XX,
        0x8b, 0xd0,
        0x83, 0xea, 0x0a,
        0x66, 0x83, 0x3a, 0x02,
        0x74, L.XX,
        0x8d, 0x45, 0xfc,
        0x8b, 0x55, 0xfc];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.CODEC_UTF16,
        text_fun(context, hp, buffer, split) {
            const __s = L.readW(context.esi);
            if (L.startWith(__s, '[f,3')) {
                split.value = 2; // history
            } else if (L.startWith(__s, '[f,0')) {
                split.value = 1; // text
            } else if (L.startWith(__s, '[f,1')) {
                split.value = 0; // name
            } else if (L.startWith(__s, '[s,')) {
                split.value = 3; //[s,36,36]「ああ…」
            } else if (L.startWith(__s, '[pi,') || L.startWith(__s, '[rp,') || L.startWith(__s, '[rs,') || L.startWith(__s, '[rpi,')) {
                return;
            }
            buffer.fromW(__s);
        },
        filter_fun(buffer) {
            //[f,1][rf,1][s,34,34][c,$FFFFFFFF][rc,$FFFFFFFF]雪之進
            //[f,0][rf,0][s,36,36][c,$FFFFFFFF][rc,$FFFFFFFF]一瞬が勝負だ。私は模造刀に手をかけ、…『[rb,座業,すわりわざ]』）で待機していた。
            let s = buffer.strW();
            s = L.re.sub(s, String.raw`\[rb,(.*?),(.*?)\]`, '$1');
            s = L.re.sub(s, String.raw`\[(.*?)\]`);
            buffer.fromW(s);
        },
    }, 'qlie4');
}

function InsertQLIEHook() {
    const _ = _4() || _5();
    return InsertQLIE1Hook() || InsertQLIE2Hook() || qlie4() || InsertQLIE3Hook() || _;
}

// ScenarioHook (Private::trim, hookBefore). The C++ comments with the sample dumps and the
// disassembly of the function are left out; hookafter (embed_fun), TextRole/TypeArgument and the
// endtype bookkeeping (only used by hookafter) are embedding and left out.

// ::CharPrevA(text, text + length) == text + length - 1: the last byte is a character of its own
function lastIsSingleChar(text, length) {
    let last = 0;
    for (let p = 0; p < length; p += L.IsShiftjisLeadByte(L.u8(text + p)) ? 2 : 1) last = p;
    return last === length - 1;
}

// returns { text, size } (text: guest address), or null for nullptr
function trim(text, length) {
    if (L.u8(text) === 0x5b) { // '['
        if (L.all_ascii(L.readA(text))) return null;
        if (L.u8(text + length - 1) === 0x5d && lastIsSingleChar(text, length)) { // ']'
            length--;
            if (L.u8(text + length - 1) === 0x6e && L.u8(text + length - 2) === 0x5b) length -= 2; // "[n"
        }
        for (let i = 1; i < length; i++) {
            const c = L.u8(text + i);
            if (c === 0 || c >= 0x80) { // (signed char)text[i] <= 0
                text += i;
                length -= i - 1;
                break;
            }
        }
        length--; // skip the leading '['
    }
    return { text, size: length };
}

// strncmp(p, k, n) == 0 for a NUL-terminated k
function strncmpEq(p, k, n) {
    const s = L.readA(p, n);
    return n <= k.length ? s === k.slice(0, n) : s.startsWith(k + '\0');
}

function hookBefore(s, hp, buffer) {
    const arg = s.edx - 4; // TextArgument: DWORD size in [edx-4], char text[] in edx
    if (!L.isAddressReadable(arg, 4)) return;
    const argSize = L.u32(arg);
    const argText = arg + 4;
    // isValid(): text && size && isAddressReadable(text, size) && strlen(text) == size
    if (!argSize || !L.isAddressReadable(argText, argSize) || L.strlen(argText) !== argSize) return;
    const t = trim(argText, argSize);
    if (!t) return;
    let trimmedText = t.text;
    let trimmedSize = t.size;
    if (trimmedSize <= 0 || !trimmedText || !L.u8(trimmedText)) return;

    if (L.readA(argText).includes('\x82\xa0\x82\xa0\x82\xa0\x82\xa0\x82\xa0')) return; /* Skip text containing あああああ */

    if (L.all_ascii(L.readA(trimmedText))) return; // This is optional, but I don't want to translate English

    const w_name_open = 0x7981; /* 【 */
    const w_name_close = 0x7a81; /* 】 */

    {
        const oldData = L.readA(trimmedText, trimmedSize);
        if (oldData.length > 3 && (oldData.substr(oldData.length - 3) === '[n]' || oldData.substr(oldData.length - 3) === '[c]')) {
            trimmedSize -= 3;
        }
    }

    if (trimmedSize > 4 && w_name_open === L.u16(trimmedText) && w_name_close === L.u16(trimmedText + trimmedSize - 2)) {
        trimmedText += 2;
        trimmedSize -= 4;
    }

    // Skip sjis 名前 = 96bc914f
    if (strncmpEq(trimmedText, '\x96\xbc\x91\x4f', trimmedSize)) return;

    buffer.from(trimmedText, trimmedSize);
}

function ScenarioHookAttach(startAddress, stopAddress) {
    // QLiE1 004FFB1D   80BB FA150000 00 CMP BYTE PTR DS:[EBX+0x15FA],0x0
    // QLiE2 0051324D   80BB 0A160000 00 CMP BYTE PTR DS:[EBX+0x160A],0x0 ; jichi: instruction used as pattern
    const bytes = [
        // i.e. 3BD0 7C 02 8BC2 0105
        0x3B, 0xD0, // CMP EDX,EAX
        0x7C, 0x02, // JL SHORT
        0x8B, 0xC2, // MOV EAX,EDX
        0x01, 0x05, // ADD DWORD PTR DS:[...],EAX
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    // 00513234   55               PUSH EBP   ; jichi: hook here
    // 00513235   8BEC             MOV EBP,ESP
    // 00513237   6A 00            PUSH 0x0
    const sig = 0x6aec8b55;
    const AlignedStep = 1; // function not aligned
    addr = L.findEnclosingFunctionBeforeDword(sig, addr, L.MaximumFunctionSize, AlignedStep);
    if (!addr) return false;
    // embed_fun (hookafter), EMBED_* flags and embed_hook_font left out
    return L.NewHook({
        address: addr,
        text_fun: hookBefore,
        lineSeparator: '[n]',
        type: L.USING_STRING | L.NO_CONTEXT,
        filter_fun(buffer) {
            buffer.fromA(L.re.sub(buffer.strA(), String.raw`\[rb,(.*?),.+\]`, '$1'));
        },
    }, 'EmbedQLIE');
}

const E = L.engine({
    name: 'QLIE',
    check: { FILE: 'GameData\\*.pack' },
    // jichi 12/25/2013: It may or may not be QLIE.
    // AlterEgo also has GameData/sound.pack but is not QLIE
    certain: false,
    attach() {
        const embed = ScenarioHookAttach(L.processStartAddress, L.processStopAddress);
        return InsertQLIEHook() || embed;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
