// Bishop.js: LunaHook's Bishop engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Bishop.cpp and Bishop.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function bishopmbcjmstojis() {
    // 特別授業
    const bytes = [
        // unsigned int __cdecl _mbcjmstojis(unsigned int C)
        0x55, 0x8b, 0xec,
        0x8b, 0x45, 0x08, // mov eax, [ebp+C]
        0x81, 0x3D, ...XX4, 0xA4, 0x03, 0x00, 0x00, // cmp dword_4A1F0C, 3A4h   //if ( dword_4A1F0C == 932 )
        ...XX2,
        0xa9, 0x00, 0x00, 0xff, 0xff, // if ( (C & 0xFFFF0000) != 0 )
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_SPLIT | L.USING_STRING }, 'bishop');
}

const E = L.engine({
    name: 'Bishop',
    check: { FILE: 'GRAPHICS\\PACK.PK' },
    certain: false,
    attach() { return bishopmbcjmstojis(); },
});

let flag = ''; // static std::wstring flag (read only by the skipped embed_fun)

function embedbishop() {
    // 黒の教室
    const bytes = [
        0x53,
        0x8b, 0x5c, 0x24, 0x0c,
        0x56,
        0x8b, 0xf7,
        0xe8, ...XX4,
        0xd9, 0xee,
        0xdd, 0x9f, ...XX4,
        0x8b, 0xc3,
        0xdb, 0x44, 0x24, 0x0c,
        0x8d, 0x50, 0x02,
        0xdd, 0x9f, ...XX4,
        0x66, 0x8b, 0x08,
        0x83, 0xc0, 0x02,
        0x66, 0x85, 0xc9];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // embed_fun and embed_hook_font left out (translation embedding)
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING | L.CODEC_UTF16,
        filter_fun(buffer) {
            if (buffer.data[0] === 0x5c) { // L'\\'
                flag = buffer.strW().substr(0, 2);
                buffer.data = buffer.data.slice(4); // size -= 4; memmove(data, data + 4, size)
            } else {
                flag = '';
            }
            let s = buffer.strW();
            s = L.re.sub(s, String.raw`\\n(　)*`);
            buffer.fromW(s);
        },
        lineSeparator: '\\n',
    }, 'bishop');
}

function Bishop2attach_function() {
    // 三射面談～連鎖する恥辱・調教の学園～
    // 特別授業3SLG
    const entry = L.FindImportEntry(L.processStartAddress, L.FindFunction('GetGlyphOutlineW'));
    if (entry === 0) return false;
    let ok = false;
    for (let addr of L.SearchMemory(L.le32(entry), L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        const xrefs = L.findxref_reverse_checkcallop(addr, Math.max(L.processStartAddress, addr - 0x100000), Math.min(L.processStopAddress, addr + 0x100000), 0xe8);
        for (const addrx of xrefs) {
            const aligned = [0xCC, 0xCC];
            let addrx1 = L.reverseFindBytes(aligned, addrx - 0x200, addrx);
            if (!addrx1) continue;
            addrx1 += 2;
            const __1 = [0xDC, 0x0D, XX, XX, XX, 0x00];
            const _1 = L.findBytes(__1, addrx - 0x30, addrx);
            if (_1 === 0) continue;
            const checkthiscall = [0x8B, 0xF9]; // mov edi, ecx
            const _3 = L.findBytes(checkthiscall, addrx1, addrx);
            ok = L.NewHook({ address: addrx1, offset: _3 ? L.stackoffset(3) : L.stackoffset(4), type: L.CODEC_UTF16 }, 'Bishop2');
        }
    }
    return ok;
}

const E2 = L.engine({
    name: 'Bishop2',
    check: { FILE: '*.bsa' },
    certain: false,
    attach() {
        // C++ `|` runs both
        const a = Bishop2attach_function();
        return embedbishop() || a;
    },
});

module.exports = [E, E2];
if (!module.parent) { L.run(E); L.run(E2); }
