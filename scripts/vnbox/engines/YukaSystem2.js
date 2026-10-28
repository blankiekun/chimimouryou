// YukaSystem2.js: LunaHook's YukaSystem2 engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/YukaSystem2.cpp and YukaSystem2.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// _yk2garbage and SpecialHookYukaSystem2 are never used by the hook (it has no text_fun): left out

function InsertYukaSystem2Hook() {
    const bytes = [
        0x55, // 004010e0  /$ 55             push ebp ; jichi; hook here
        0x8b, 0xec, // 004010e1  |. 8bec           mov ebp,esp
        0x8b, 0x45, 0x08, // 004010e3  |. 8b45 08        mov eax,dword ptr ss:[ebp+0x8] ; jichi: ebp+0x8 = arg2
        0x8b, 0x4d, 0x0c, // 004010e6  |. 8b4d 0c        mov ecx,dword ptr ss:[ebp+0xc]
        0x8a, 0x11, // 004010e9  |. 8a11           mov dl,byte ptr ds:[ecx]
        0x88, 0x10, // 004010eb  |. 8810           mov byte ptr ds:[eax],dl    ; jichi: eax is the address to text
        0x5d, // 004010ed  |. 5d             pop ebp
        0xc3, // 004010ee  \. c3             retn
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.stackoffset(2),
        type: L.USING_SPLIT | L.USING_STRING | L.CODEC_UTF8, // UTF-8, though
        filter_fun(buffer) {
            let str = buffer.strA();
            if (L.all_ascii(str)) return buffer.clear();
            str = L.re.sub(str, String.raw`@r\((.*?),(.*?)\)`, '$1');
            const wstr = L.StringToWideString(str, L.CP_UTF8);
            if ([...wstr].length === 1) return buffer.clear();
            for (const c of wstr) {
                const wc = c.charCodeAt(0);
                if ((wc >= 0x41 && wc <= 0x7a) || // 'A'..'z'
                    (wc >= 0x30 && wc <= 0x39) ||
                    wc === 0x22 || wc === 0x2e || wc === 0x2d || wc === 0x23 || // '"', '.', '-', '#'
                    wc === 65533 || wc === 2) return buffer.clear();
            }
            buffer.fromA(str);
        },
    }, 'YukaSystem2');
}

function hook2() {
    const bytes = [
        0x0F, 0xB6, 0x07,
        0x83, 0xE8, 0x40,
        0x75, XX,
        0x0F, 0xB6, 0x47, 0x01,
        0x83, 0xE8, 0x67,
        0x8D, 0x4F, 0x01,
        0x75, XX,
        0x0F, 0xB6, 0x41, 0x01,
        0x83, 0xC1, 0x01,
        0x83, 0xE8, 0x66,
        0x74, XX];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_SPLIT | L.DATA_INDIRECT,
        index: 0,
        split: L.stackoffset(1),
    }, 'YukaSystem2');
}

function YukaSystem1Filter(buffer) {
    let text = buffer.strA();
    if (text.length >= 2 && text.charCodeAt(text.length - 2) > 0 && text.charCodeAt(text.length - 2) < 0x80) { // char > 0
        text += ' ';
        buffer.fromA(text);
    }
    if (text.includes('@r(')) {
        L.StringFilterBetweenA(buffer, '@r(', ')'); // @r(2,はと)
    }
}

function InsertYukaSystem1Hook() {
    /*
     * Sample games:
     * https://vndb.org/r71601
     * https://vndb.org/v7507
     */
    const bytes = [
        0x80, 0x3D, ...XX4, 0x01, // cmp byte ptr [kimihime.exe+16809C],01     << hook here
        0x75, 0x11, // jne kimihime.exe+42D74
        0xB9, ...XX4, // mov ecx,kimihime.exe+C7F8C
        0xC6, 0x05, ...XX4, 0x00, // mov byte ptr [kimihime.exe+1516C5],00
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.KNOWN_UNSTABLE,
        filter_fun: YukaSystem1Filter,
    }, 'YukaSystem1');
}

function h1() {
    let addr = L.FindImportEntry(L.processStartAddress, L.FindFunction('IsDBCSLeadByteEx'));
    if (!addr) return false;
    const bytes = [
        0xff, 0x15, ...L.le32(addr),
        0x83, 0xf8, 0x01,
        0x0f, 0x85, ...XX4,
        0x33, 0xd2,
        0xb9, 0x02, 0x00, 0x00, 0x00,
        0xbf, ...XX4,
        0x8b, 0xf3,
        0x33, 0xc0,
        0xf3, 0xa6,
        0x74, XX,
        0xb8, ...XX4,
        0x8a, 0x48, 0x02,
        0x83, 0xc0, 0x02,
        0x83, 0xc2, 0x02,
        0x84, 0xc9,
        0x74, XX,
        0xb9, 0x02, 0x00, 0x00, 0x00,
        0x8b, 0xf8,
        0x8b, 0xf3,
        0x33, 0xed,
        0xf3, 0xa6];
    addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_CHAR | L.DATA_INDIRECT,
        filter_fun(buffer) { L.CharFilterA(buffer, '@'); },
    }, 'caramelbox');
}

const E = L.engine({
    name: 'YukaSystem2',
    check: { FILE: '*.ykc' },
    attach() {
        const _1 = h1() || InsertYukaSystem1Hook();
        return InsertYukaSystem2Hook() || hook2() || _1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
