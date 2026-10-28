// VanillawareGC.js: LunaHook's VanillawareGC engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/VanillawareGC.cpp and VanillawareGC.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const VNR_TEXT_CAPACITY = 1500;

// Return true if the text is a garbage character
const _vanillawaregarbage_ch = (c) => c === 0x20 || c === 0x2e || c === 0x2f || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x7a); // also ignore ASCII 91-96: [ \ ] ^ _ `

// Return true if the text is full of garbage characters
function _vanillawaregarbage(p) {
    for (let count = 0; L.u8(p) && count < VNR_TEXT_CAPACITY; count++, p++) {
        if (!_vanillawaregarbage_ch(L.u8(p))) return false;
    }
    return true;
}

let lasttext = 0; // static LPCSTR lasttext
function SpecialGCHookVanillaware(context, hp, buffer, split) {
    const text = (context.eax + hp.user_value) >>> 0;
    if (lasttext !== text && L.u8(text) && !_vanillawaregarbage(text)) {
        lasttext = text;
        split.value = context.ecx;
        buffer.fromCharPtr(text);
    }
}

// jichi 7/17/2014: Search mapped memory for emulators
function _SafeMatchBytesInMappedMemory(pattern, start, stop, step) {
    for (let i = start; i < stop; i += step) { // + patternSize to avoid overlap
        const r = L.findBytes(pattern, i, i + step + pattern.length + 1);
        if (r) return r;
    }
    return 0;
}

function SafeMatchBytesInGCMemory(pattern) {
    const start = 0x01000000; // MemDbg::MappedMemoryStartAddress
    const stop = 0x7ffeffff; // MemDbg::MemoryStopAddress
    return _SafeMatchBytesInMappedMemory(pattern, start, stop, start);
}

function InsertVanillawareGCHook() {
    const bytes = [
        0x83, 0xc4, 0x04, // 16094193   83c4 04          add esp,0x4
        0xeb, 0x11, // 16094196   eb 11            jmp short 160941a9
        0x8b, 0xc1, // 16094198   8bc1             mov eax,ecx
        0x81, 0xe0, 0xff, 0xff, 0xff, 0x3f, // 1609419a   81e0 ffffff3f    and eax,0x3fffffff
        0x0f, 0xb6, 0x80, ...XX4, // 160941a0   0fb680 00000810  movzx eax,byte ptr ds:[eax+0x10080000] ; jichi: hook here
        0x66, 0x90, // 160941a7   66:90            nop
        0x81, 0xc6, 0x01, 0x00, 0x00, 0x00, // 160941a9   81c6 01000000    add esi,0x1
        // 0x89,05 80f86701      // 160941af   8905 80f86701    mov dword ptr ds:[0x167f880],eax
        // 0x81,3d 80f86701 00   // 160941b5   813d 80f86701 00>cmp dword ptr ds:[0x167f880],0x0
        // 0xc7,05 8cf86701 00   // 160941bf   c705 8cf86701 00>mov dword ptr ds:[0x167f88c],0x0
        // 0x89,35 90f86701      // 160941c9   8935 90f86701    mov dword ptr ds:[0x167f890],esi
        // 0x7c, 14              // 160941cf   7c 14            jl short 160941e5
        // 0x7f, 09              // 160941d1   7f 09            jg short 160941dc
        // 0xc6,05 0cfb6701 02   // 160941d3   c605 0cfb6701 02 mov byte ptr ds:[0x167fb0c],0x2
        // 0xeb, 26              // 160941da   eb 26            jmp short 16094202
    ];
    const memory_offset = 3; // 160941a0   0fb680 00000810  movzx eax,byte ptr ds:[eax+0x10080000]
    const addr_offset = 0x160941a0 - 0x16094193;

    const addr = SafeMatchBytesInGCMemory(bytes);
    let succ = false;
    if (addr) {
        const address = addr + addr_offset;
        succ = L.NewHook({
            address,
            user_value: L.u32(address + memory_offset),
            text_fun: SpecialGCHookVanillaware,
            type: L.USING_STRING | L.NO_CONTEXT, // no context is needed to get rid of variant retaddr
        }, 'Vanillaware GC');
    }
    return succ;
}

const E = L.engine({
    name: 'VanillawareGC',
    check: { FILE: 'Dolphin.exe' },
    attach() {
        // jichi 7/20/2014 Dolphin, tested with Dolphin 4.0: InsertGCHooks (TODO: add generic hooks)
        return InsertVanillawareGCHook();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
