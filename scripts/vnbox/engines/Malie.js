// Malie.js: LunaHook's Malie engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Malie.cpp and Malie.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: hookafter (embed_fun), the Patch namespace (PatchMalieFont: replaces the font name through
// shared memory), the EMBED flags, the `data` buffer the scenario hook builds for embedding.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// Util: ithsys SearchPattern(base, length, pattern): the offset of the first match, 0 when none
function SearchPattern(base, length, pattern) {
    const a = L.findBytes(pattern, base, base + length);
    return a ? a - base : 0;
}

/********************************************************************************************
Malie hook:
  Process name is malie.exe.
  Malie engine store text string in linked list. We need to insert a hook to where it travels the list.
  At that point EBX should point to a structure. We can find character at -8 and font size at +10.
********************************************************************************************/
function InsertMalieHook1() {
    const sig1 = [0xc1, 0xe3, 0x05]; // DWORD 0x05e3c1, 3 bytes, little endian
    const sig1_size = 3;
    let i = SearchPattern(L.processStartAddress, L.processStopAddress - L.processStartAddress, sig1);
    if (!i) return false;

    const sig2 = [0x83, 0xc3]; // WORD 0xc383
    const sig2_size = 2;
    const j = i + L.processStartAddress + sig1_size;
    i = SearchPattern(j, L.processStopAddress - j, sig2);
    if (!i) return false; // jichi 8/19/2013: Change the condition fro J to I
    return L.NewHook({
        address: j + i,
        offset: L.regoffset('ebx'),
        index: -0x8,
        split: L.regoffset('ebx'),
        split_index: 0x10,
        type: L.CODEC_UTF16 | L.USING_SPLIT | L.DATA_INDIRECT | L.SPLIT_INDIRECT,
    }, 'Malie');
}

let malie_furi_flag_ = 0; // jichi 8/20/2013: Make it global so that it can be reset
function SpecialHookMalie(context, hp, buffer, split) {
    const ch = context.eax & 0xffff,
        ptr = context.edi;

    if (malie_furi_flag_) {
        const index = context.edx;
        if (L.u16(ptr + index * 2 - 2) < 0xa) malie_furi_flag_ = 0;
    } else if (ch === 0xa) {
        malie_furi_flag_ = 1;
    }
    buffer.from_t(ch, 2);
}

function InsertMalieHook2() { // jichi 8/20/2013: Change return type to boolean
    const bytes = [0x66, 0x3d, 0x1, 0x0];
    const start = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!start) return false;
    let ptr = start;
    while (true) {
        if (L.u16(ptr) === 0x3d66) {
            ptr += 4;
            if (L.u8(ptr) === 0x75) {
                ptr += L.u8(ptr + 1) + 2;
                continue;
            }
            if (L.u16(ptr) === 0x850f) {
                ptr = (ptr + L.u32(ptr + 2) + 6) >>> 0;
                continue;
            }
        }
        break;
    }
    malie_furi_flag_ = 0; // reset old malie flag
    return L.NewHook({
        address: ptr + 4,
        offset: L.regoffset('eax'),
        text_fun: SpecialHookMalie,
        type: L.USING_SPLIT | L.CODEC_UTF16 | L.NO_CONTEXT | L.USING_CHAR,
    }, 'Malie');
}

function SpecialHookMalie2(context, hp, buffer, split) {
    buffer.from_t(context.eax & 0xffff, 2);
    // s1 = stack[3], base split, which is stable; s2 = stack[0], used to split out furigana, but un stable
    // (both are computed and unused in the C++)
}

function InsertMalie2Hook() {
    const bytes1 = [
        0x40,             // inc eax
        0x89, 0x56, 0x08, // mov dword ptr ds:[esi+0x8],edx
        0x33, 0xd2,       // xor edx,edx
        0x89, 0x46, 0x04  // mov dword ptr ds:[esi+0x4],eax
    ];
    const range1 = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes1, L.processStartAddress, L.processStartAddress + range1);
    if (!addr) return false;

    addr += bytes1.length; // skip bytes1
    const bytes2 = [0x85, 0xc0]; // WORD 0xc085: test eax,eax
    const range2 = 0x200;
    addr = L.findBytes(bytes2, addr, addr + range2);
    if (!addr) return false;

    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_SPLIT | L.NO_CONTEXT | L.CODEC_UTF16 | L.USING_CHAR,
        text_fun: SpecialHookMalie2,
    }, 'Malie2');
}

const _MALIE3_MAX_LENGTH = 1500; // VNR_TEXT_CAPACITY
const w16 = (p, i) => L.u16(p + 2 * i);
function _Malie3LTrim(p) {
    if (p) {
        for (let count = 0; count < _MALIE3_MAX_LENGTH; count++, p += 2) {
            if (w16(p, 0) === 0x76 /* v */ && w16(p, 1) === 0x5f /* _ */) { // ex. v_akr0001, v_mzk0001
                p += 9 * 2;
                return p; // must return otherwise trimming more will break the ITH repetition elimination
            } else if (w16(p, 0) >= 0xa) { // ltrim illegal characters less than 0xa
                return p;
            }
        }
    }
    return 0;
}
function _Malie3RTrim(p) {
    if (p) {
        for (let count = 0; count < _MALIE3_MAX_LENGTH; count++, p -= 2) {
            if (w16(p, -1) >= 0xa) { // trim illegal characters less than 0xa
                if (w16(p, -1) >= 0x30 && w16(p, -1) <= 0x39 && w16(p, -1 - 7) === 0x5f) p -= 9 * 2;
                else return p;
            }
        }
    }
    return 0;
}
function _Malie3GetEOL(p) {
    if (p) {
        for (let count = 0; count < _MALIE3_MAX_LENGTH; count++, p += 2) {
            switch (w16(p, 0)) {
                case 0:
                case 0xa: // stop at \0, or \n where the text after 0xa is furigana
                    return p;
                case 0x7:
                    if (w16(p, 1) < 0xa && w16(p, 1) !== 0x1) return p;
            }
        }
    }
    return 0;
}

function SpecialHookMalie3(context, hp, buffer, split) {
    const ecx = context.ecx, edx = context.edx;
    const start = _Malie3LTrim((ecx + edx * 2) >>> 0),
        stop = _Malie3RTrim(_Malie3GetEOL(start));
    if (!start || !stop) return buffer.clear();
    buffer.from(start, Math.max(0, stop - start)); // max(0, stop - start) wchars * 2 = the byte difference
}

function IllegalCharsFilterW(buffer) {
    L.CharsFilterW(buffer, '\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0b\x0c\x0e\x0f\x10\x11\x12\x12\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f');
}
function InsertMalie3Hook() {
    const bytes = [
        0x8b, 0x44, 0x24, 0x04, // 5b51e0  mov eax,dword ptr ss:[esp+0x4]   ; jichi: function starts
        0x56,                   // 5b51e4  push esi
        0x57,                   // 5b51e5  push edi
        0x8b, 0x50, 0x08,       // 5b51e6  mov edx,dword ptr ds:[eax+0x8]
        0x8b, 0x08,             // 5b51e9  mov ecx,dword ptr ds:[eax]
        0x33, 0xf6,             // 5b51eb  xor esi,esi
        0x66, 0x8b, 0x34, 0x51, // 5b51ed  mov si,word ptr ds:[ecx+edx*2] // jichi: hook here
        0x42                    // 5b51f1  inc edx
    ];
    const addr_offset = 0x5b51ed - 0x5b51e0;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        filter_fun: IllegalCharsFilterW, // remove illegal control chars such as 0x07,0x01
        text_fun: SpecialHookMalie3,
        type: L.USING_SPLIT | L.NO_CONTEXT | L.CODEC_UTF16,
    }, 'Malie3');
}

function InsertMalie4Hook() {
    const bytes = [
        0x50,                   // 65904E | 50                       | push eax                                | mireado: pattern starts
        0x8B, 0x45, 0x10,       // 65904F | 8B 45 10                 | mov eax,dword ptr ss:[ebp+10]           |
        0xD9, 0x9F, ...XX4,     // 659052 | D9 9F E8 6B 87 00        | fstp dword ptr ds:[edi+876BE8]          |
        0x0F, 0xB7, 0x04, 0x58, // 659058 | 0F B7 04 58              | movzx eax,word ptr ds:[eax+ebx*2]       |
        0x50,                   // 65905C | 50                       | push eax                                |
        0x51,                   // 65905D | 51                       | push ecx                                |
        0xE8, ...XX4,           // 65905E | E8 DD 1D EA FF           | call malie.4FAE40                       | mireado: hook here
        0x8B, 0x45, 0x14,       // 659063 | 8B 45 14                 | mov eax,dword ptr ss:[ebp+14]           |
        0x83, 0xC4, 0x10        // 659066 | 83 C4 10                 | add esp,10                              |
    ];
    const addr_offset = 0x65905E - 0x65904E;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('eax'), // pusha_eax_off - 4
        split: L.regoffset('edx'), // jichi 12/17/2013: This could split the furigana, but will mess up the text
        type: L.USING_SPLIT | L.NO_CONTEXT | L.CODEC_UTF16,
    }, 'Malie4');
}

function InsertMalie5Hook() {
    const bytes = [
        0x8b, 0x49, 0x10, // mov ecx,[ecx+10]
        0x03, 0x08,       // add ecx,[eax]
        0x51              // push ecx
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (addr) {
        return L.NewHook({ address: addr + 5, offset: L.regoffset('ecx'), type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'Malie5');
    }
    return false;
}

function InsertMalieHook() {
    if (L.CheckFile('tools.dll')) {
        return InsertMalieHook1(); // jichi 3/5/2015: For old light games such as Dies irae.
    } else { // For old Malie games before 2015
        let ok = false;

        if (L.CheckFile('System\\*')) { // Insert old Malie hook. There are usually System/cursor.cur
            ok = InsertMalieHook2() || ok;
            ok = InsertMalie2Hook() || ok; // jichi 8/20/2013
        }

        ok = InsertMalie3Hook() || ok; // jichi 3/7/2014
        ok = InsertMalie4Hook() || ok;
        ok = InsertMalie5Hook() || ok;
        return ok;
    }
}

// ---- ScenarioHook (Private): the text of a script line; wide strings are read from guest memory
// text: an address of UTF-16 text
function parseTextSize(text) {
    let count = 0;
    let skipNull = false;
    for (let i = 0; w16(text, i) || skipNull; i++, count++) {
        if (w16(text, i) === 0) skipNull = false;
        else if (w16(text, i) === 0x7) {
            switch (w16(text, i + 1)) {
                case 0x1: // ruby
                    skipNull = true;
                    break;
                case 0x8: // voice
                    return count;
                case 0x6: // pause
                    return count + 2;
            }
        }
    }
    return count;
}
function rtrim(text, size) {
    while (size && (text.charCodeAt(size - 1) <= 32 || text.charCodeAt(size - 1) === 0x3000)) // trim trailing non-printable characters
        size--;
    return size;
}
// returns the text as a JS string (the C++ returns its UTF-16 bytes)
function parseTextData(text) {
    let ret = '';
    // wcschr(text, 0x7)
    let has7 = false;
    for (let i = 0; w16(text, i); i++) if (w16(text, i) === 0x7) { has7 = true; break; }
    if (!has7) return L.readW(text);
    for (let i = 0; w16(text, i); i++) {
        if (w16(text, i) === 0x7) {
            switch (w16(text, i + 1)) {
                case 0x1: { // ruby
                    let p = -1;
                    for (let k = i + 2; w16(text, k); k++) if (w16(text, k) === 0xa) { p = k; break; }
                    if (p >= 0) {
                        ret += L.readW(text + 2 * (i + 2), p - i - 2);
                        let e = p;
                        while (w16(text, e)) e++;
                        i = e; // text now point to zero
                        continue;
                    } // mismatched ruby that should never happen
                    return '';
                }
                case 0x8: // voice
                    return ret;
                case 0x6: // pause
                    ret += L.readW(text + 2 * i, 2);
                    return ret;
            }
        }
        ret += String.fromCharCode(w16(text, i));
    }
    return ret;
}
const MALIE_0 = '[0]'; // represent \0 (used by the skipped hookafter)
function filterTextData(text) {
    return L.strReplace(text, '\x07\x04'); // static shortPause
}
function hookBefore(context, hp, buffer, role) {
    let text = context.stack[1];
    if (!text || !w16(text, 0) || (!(w16(text, 0) === 0x7 && w16(text, 1) === 0x8) && L.all_ascii(L.readW(text)))) return;
    const retaddr = context.stack[0];
    // switch (*(DWORD *)retaddr & 0xff0000ff) { case 0x5700008b / 0x8300008b / 0x46000089: break; }: nothing happens
    let collect = '';
    for (let size; w16(text, 0); text += size * 2) {
        if (w16(text, 0) === 0x7 && w16(text, 1) === 0x8) { // voiced
            const len = L.wcslen(text);
            text += (len + 1) * 2;
        }
        size = parseTextSize(text);
        const oldData = filterTextData(parseTextData(text));
        if (!oldData.length) return; // this should never happen
        const trimmedSize = rtrim(oldData, oldData.length);
        if (trimmedSize === 0 || L.all_ascii(oldData.substr(0, trimmedSize))) {
            // data.append(oldData): only used for embedding
        } else {
            collect += oldData.substr(0, trimmedSize);
        }
    }
    buffer.fromW(collect);
}
function attachScenario(startAddress, stopAddress) {
    const bytes = [
        0x83, 0xC4, 0x08, // 00653B0A   83C4 08          ADD ESP,0x8
        0x85, XX,         // 00653B0D   85DB             TEST EBX,EBX
        0x74, 0x12,       // 00653B0F   74 12            JE SHORT malie.00653B23
        0x8B, XX,         // 00653B11   8BCF             MOV ECX,EDI
        0x8B, XX,         // 00653B13   8BFB             MOV EDI,EBX
        0x8B, XX,         // 00653B15   8BC1             MOV EAX,ECX
        0xC1, 0xE9, 0x02, // 00653B17   C1E9 02          SHR ECX,0x2
        0xF3, 0xA5,       // 00653B1A   F3:A5            REP MOVS DWORD PTR ES:[EDI],DWORD PTR DS:[ESI]
        0x8B, XX,         // 00653B1C   8BC8             MOV ECX,EAX
        0x83, 0xE1, 0x03, // 00653B1E   83E1 03          AND ECX,0x3
        0xF3, 0xA4        // 00653B21   F3:A4            REP MOVS BYTE PTR ES:[EDI],BYTE PTR DS:[ESI]
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, text_fun: hookBefore, type: L.CODEC_UTF16 | L.NO_CONTEXT }, 'EmbedMalie');
}

// ---- malie_light (readString walks the 0x7 control codes of the script string)
function readString(address) {
    let s = '';
    let c;
    while ((c = L.u16(address)) !== 0) {
        if (c >= 0x20) {
            s += String.fromCharCode(c);
            address = address + 2;
        } else if (c === 0x7) {
            address = address + 2;
            const cmd = L.u16(address);
            address = address + 2; // skip cmd
            if (cmd === 0x8) {
                while ((c = L.u16(address)) !== 0) address = address + 2;
                address = address + 2;
            }
            if (cmd === 0x6) return s;
            if (cmd === 0x1) {
                while ((c = L.u16(address)) !== 0) {
                    if (c === 0xa) {
                        address = address + 2;
                        while ((c = L.u16(address)) !== 0) address = address + 2;
                        break;
                    } else {
                        s += String.fromCharCode(c);
                        address = address + 2;
                    }
                }
                address = address + 2;
            }
        } else {
            address = address + 2;
        }
    }
    return '';
}
let _ws = ''; // static std::wstring _ws
function textfun_light(context, hp, buffer, split) {
    const eax = context.eax;
    const ecx = L.u32(eax);
    const edx = context.edx;
    const str = readString(ecx + edx * 2);
    if (_ws === str) return;
    _ws = str;
    buffer.fromW(_ws);
}
function malie_light() {
    const pattern = [
        0x8b, 0x08, // 往前两个字节，否则jump到下个指令（被hook截断）会崩溃
        0x0f, XX, XX, XX, 0x89, XX, XX, 0x8d, XX, XX, 0x89, XX, XX, 0x8d, XX, XX, 0x00, 0x00, 0x00, 0x00];
    const addr = L.findBytes(pattern, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, text_fun: textfun_light, type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT }, 'malie_6');
}

let _switch = false;
let __s = '';
let h7last = ''; // static std::wstring last
function h7() {
    const RichString_FormatEx = L.GetProcAddress(L.GetModuleHandleW('tools.dll'), 'RichString_FormatEx');
    if (!RichString_FormatEx) return false; // 防止脑残问为什么failed
    if (!L.NewHook({
        type: L.CODEC_UTF16 | L.USING_STRING,
        offset: L.stackoffset(2),
        address: RichString_FormatEx,
        filter_fun(buffer) {
            const s = buffer.strW();
            _switch = (h7last === s);
            if (!_switch) __s = '\n';
            h7last = s;
            buffer.clear();
        },
    }, 'RichString_FormatEx')) return false;
    return L.NewHook({
        address: L.FindFunction('GetTextExtentExPointW'),
        type: L.CODEC_UTF16 | L.USING_CHAR | L.DATA_INDIRECT,
        offset: L.stackoffset(2),
        filter_fun(buffer) {
            if (_switch) {
                buffer.fromW(__s);
                __s = '';
            }
        },
    }, 'GetTextExtentExPointW');
}

const E = L.engine({
    name: 'Malie',
    check: { FILE_ANY: ['Malie.ini', 'Malie.exe'] },
    attach() {
        const embed = attachScenario(L.processStartAddress, L.processStopAddress);
        let b1 = InsertMalieHook() || embed;
        b1 = malie_light() || b1;
        b1 = h7() || b1;
        return b1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
