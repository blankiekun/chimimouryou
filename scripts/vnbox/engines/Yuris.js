// Yuris.js: LunaHook's Yuris engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Yuris.cpp and Yuris.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

let codepage = 0; // Yuris::codepage, set by codepagechecker() in attach

function InsertYuris1Hook() {
    const size = L.processStopAddress - L.processStartAddress;
    let entry = L.FindCallAndEntryBoth(L.FindFunction('TextOutA'), size, L.processStartAddress, 0xec83);
    if (!entry) return false;
    entry = L.FindCallAndEntryRel(entry - 4, size, L.processStartAddress, 0xec83);
    if (!entry) return false;
    entry = L.FindCallOrJmpRel(entry - 4, size - 0x10000, L.processStartAddress + 0x10000, false);
    let i, t = 0;
    try { // jichi 12/27/2014
        for (i = entry - 4; i > entry - 0x100; i--) {
            if (L.IsBadReadPtr(i, 4)) { // might raise in new YU-RIS, 4 = sizeof(DWORD)
                return false;
            } else if (L.u16(i) === 0xc085) {
                t = L.u16(i + 2);
                if ((t & 0xff) === 0x76) {
                    t = 4;
                    break;
                } else if ((t & 0xffff) === 0x860f) {
                    t = 8;
                    break;
                }
            }
        }
    } catch (e) {
        return false;
    }
    if (i === entry - 0x100) return false;
    return L.NewHook({
        address: i + t,
        offset: L.regoffset('edi'),
        split: L.regoffset('eax'),
        type: L.USING_STRING | L.USING_SPLIT,
    }, 'YU-RIS');
}

function InsertYuris2Hook() {
    const addr = L.findCallAddress(L.FindFunction('TextOutA'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.USING_SPLIT | L.NO_CONTEXT | L.INLINE_HOOK, // disable context that will cause thread split
        offset: L.stackoffset(3),
        split: L.stackoffset(5),
    }, 'YU-RIS2');
}

function InsertYuris4Hook() {
    /*
     * Sample games:
     * https://vndb.org/v6540
     */
    let found = false;
    const pattern = [
        0x52, // 52               push edx
        0x68, 0x00, 0x42, 0x5C, 0x00, // 68 00425C00      push euphoria.exe+1C4200
        0xFF, 0x15, 0x90, 0x44, 0x7E, 0x00, // FF 15 90447E00   call dword ptr [euphoria.exe+3E4490]
        0x83, 0xC4, 0x0C, // 83 C4 0C         add esp,0C
        0xEB, 0x5F, // EB 5F            jmp euphoria.exe+4F4C5
        0xFF, 0x35, 0xA4, 0x19, 0x66, 0x00, // FF 35 A4196600   push [euphoria.exe+2619A4]
        0x52, // 52               push edx
    ];
    const addr_offset = 12; // distance to the beginning of the function, which is 0x83, 0xC4, 0x0C (add esp,0C)
    for (const addr of L.SearchMemory(pattern, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        found = L.NewHook({
            address: addr + addr_offset,
            offset: L.regoffset('edx'),
            type: L.USING_STRING,
        }, 'YU-RIS4') || found;
    }
    return found;
}

function InsertYuris5Hook() {
    /*
     * Sample games:
     * https://vndb.org/v4037
     */
    const bytes = [
        0x33, 0xD2, // xor edx,edx
        0x88, 0x14, 0x0F, // mov [edi+ecx],dl
        0xA1, ...XX4, // mov eax,[exe+2DE630]
        0x8B, 0x78, 0x3C, // mov edi,[eax+3C]
        0x8B, 0x58, 0x5C, // mov ebx,[eax+5C]
        0x88, 0x14, 0x3B, // mov [ebx+edi],dl
    ];
    const addr_offset = 0; // distance to the beginning of the function, which is 0x55 (push ebp)
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING | L.NO_CONTEXT,
    }, 'YU-RIS5');
}

let yuris6Last = ''; // static std::string last
function Yuris6Filter(buffer, hp) {
    if (yuris6Last === buffer.strA()) return buffer.clear();
    yuris6Last = buffer.strA();
    if (hp.codepage === L.CP_UTF8 || (hp.type & L.CODEC_UTF8)) {
        buffer.fromA(L.re.sub(buffer.strA(), L.utf8A('≪') + '(.*?)' + L.utf8A('／') + '(.*?)' + L.utf8A('≫'), '$1'));
        buffer.fromA(L.re.sub(buffer.strA(), L.utf8A('＜') + '(.*?)' + L.utf8A('／') + '(.*?)' + L.utf8A('＞'), '$1'));
    } else {
        buffer.fromA(L.re.sub(buffer.strA(), String.raw`\x81\x83(.*?)\x81\x5E(.*?)\x81\x84`, '$1'));
        buffer.fromA(L.re.sub(buffer.strA(), String.raw`\x81\xE1(.*?)\x81\x5E(.*?)\x81\xE2`, '$1'));
        L.CharReplacerA(buffer, '=', '-');
        L.StringFilterA(buffer, '\xEF\xF0');
        L.StringFilterA(buffer, '\xEF\xF1');
        L.StringFilterA(buffer, '\xEF\xF2');
        L.StringFilterA(buffer, '\xEF\xF3');
        L.StringFilterA(buffer, '\xEF\xF4');
        L.StringFilterA(buffer, '\xEF\xF5');
        L.StringFilterA(buffer, '\x81\x98');
    }
}

function InsertYuris6Hook() {
    /*
     * work with Windows 11
     * Sample games:
     * https://vndb.org/v40058
     * https://vndb.org/v42883
     * https://vndb.org/v44092
     * https://vndb.org/v21171
     * https://vndb.org/r46910
     */
    const bytes = [
        0xE9, ...XX4, // jmp oshitona01.exe+1B629     << hook here
        0xBF, ...XX4, // mov edi,oshitona01.exe+24EEA0
        0x8A, 0x17, // mov dl,[edi]
        0x47, // inc edi
        0x88, 0x16, // mov [esi],dl
        0x46, // inc esi
        0x84, 0xD2, // test dl,dl
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    const checkbefore = [
        0x8b, 0x78, XX,
        0x8a, 0x17,
        0x47,
        0x88, 0x16,
        0x46,
        0x84, 0xd2,
        0x75, 0xf6];
    const hp = {
        address: addr,
        offset: L.regoffset('eax'),
        index: 0x38,
    };
    if (L.MatchPattern(addr - checkbefore.length, checkbefore)) {
        hp.index = L.u8(addr - checkbefore.length + 2);
    }
    hp.filter_fun = Yuris6Filter;
    hp.type = L.USING_STRING | L.NO_CONTEXT | L.DATA_INDIRECT;
    hp.codepage = codepage;
    return L.NewHook(hp, 'YU-RIS6');
}

const yuris78Chars = new Set(['1', '2', 'E', 'C', 'c', 'R', 'B', 'P', 'Z']);
function yuris78Filter(buffer) {
    if ([...buffer.strA()].every((c) => yuris78Chars.has(c))) return buffer.clear();
}

function yuris7() {
    const bytes = [
        0x57, 0x56, 0x55, 0x53, 0x83, 0xec, 0x10,
        0x8b, 0x5c, 0x24, 0x24,
        0x8b, 0x15, ...XX4,
        0x8b, 0x0c, 0x9a,
        0xc6, 0x41, 0x01, 0x03,
        0x8b, 0xc3,
        0xe8];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            if (context.edi > 0x100) return;
            if (context.edi < 0x60 || context.edi > 0x80) return;
            const s = L.readA(context.edx);
            if (s.length > 2) return;
            if (s === 'BG' || s === 'VO') return;
            split.value = context.edi; // |(context->eax*0x100);会把人名的引号分开
            buffer.from(context.edx, Math.min(2, s.length));
        },
        codepage,
        filter_fun: yuris78Filter,
    }, 'yuris7');
}

const yuris9cache = []; // static lru_cache<std::string> cache(4)
function yuris9touch(s) {
    const i = yuris9cache.indexOf(s);
    if (i >= 0) {
        yuris9cache.splice(i, 1);
        yuris9cache.push(s);
        return true;
    }
    yuris9cache.push(s);
    if (yuris9cache.length > 4) yuris9cache.shift();
    return false;
}

function yuris8() {
    const bytes = [
        0x8b, XX,
        0x8b, 0x94, 0x24, XX, 0, 0, 0,
        0x8b, 0x8c, 0x24, XX, 0, 0, 0,
        0xe8, ...XX4,
        0xeb, XX,
        0x8b, XX,
        0x8b, 0x94, 0x24, XX, 0, 0, 0,
        0x8b, 0x8c, 0x24, XX, 0, 0, 0,
        0xe8, ...XX4];
    const bytes2 = [
        0x8b, XX,
        0x8b, 0x94, 0x24, XX, 0, 0, 0,
        0x8b, 0x8c, 0x24, XX, 0, 0, 0,
        0xe8, ...XX4,
        0xeb, XX,
        0x8b, XX,
        0x8b, XX,
        0x8b, 0x8c, 0x24, XX, 0, 0, 0,
        0xe8, ...XX4];
    let offset = bytes.length - 5;
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        offset = bytes2.length - 5;
    }
    if (!addr) return false;
    const hp = {
        address: addr + offset,
        type: L.USING_STRING,
        offset: L.regoffset('ecx'),
        codepage,
        filter_fun: yuris78Filter,
    };
    const calltarget = (addr + offset + 5 + L.i32(addr + offset + 1)) >>> 0;
    const yuris9 = () => {
        /* 在这里也可以: .text:0045346F E8 84 85 00 00  call sub_45B9F8 */
        return L.NewHook({
            address: calltarget,
            type: L.USING_STRING | L.NO_CONTEXT | L.FULL_STRING | L.INLINE_HOOK,
            offset: L.regoffset('ecx'),
            codepage,
            text_fun(context, hp, buffer) {
                const text = L.readA(context.ecx);
                if (text.length <= 2) return;
                if (text[0] !== '"' && text[text.length - 1] !== '"') return;
                if (yuris9touch(text)) return;
                buffer.fromA(text.substr(1, text.length - 2));
            },
        }, 'yuris9');
    };
    return L.NewHook(hp, 'yuris8') && yuris9();
}

function codepagechecker() {
    const wcmb = L.FindImportEntry(L.processStartAddress, L.FindFunction('WideCharToMultiByte'));
    if (!wcmb) return 0;
    const check = [
        0x68, 0xA4, 0x03, 0x00, 0x00,
        0xff, 0x15, ...L.le32(wcmb)];
    if (!L.findBytes(check, L.processStartAddress, L.processStopAddress)) return 0;
    return L.CP_UTF8;
}

const E = L.engine({
    name: 'Yuris',
    // jichi 8/1/2014: YU-RIS engine, lots of clockup game also has this pattern
    // jichi 8/14/2013: CLOCLUP: "ノーブレスオブリージュ" would crash the game.
    check: () => L.CheckFileAny(['pac\\*.ypf', '*.ypf']) && !L.CheckFile('noblesse.exe'),
    certain: false,
    attach() {
        codepage = codepagechecker();
        let ok = InsertYuris1Hook();
        ok = InsertYuris2Hook() || ok;
        ok = InsertYuris4Hook() || ok;
        ok = InsertYuris5Hook() || ok;
        ok = InsertYuris6Hook() || ok;
        ok = yuris7() || ok;
        ok = yuris8() || ok;
        return ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
