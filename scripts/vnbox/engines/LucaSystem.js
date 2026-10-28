// LucaSystem.js: LunaHook's LucaSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/LucaSystem.cpp and LucaSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function LucaSystemFilter(buffer) {
    let ws = buffer.strAW();
    ws = L.strReplace(ws, '＃', '');
    ws = L.strReplace(ws, '＄', ' ');
    // replacement from Flowers 4 config.json
    ws = L.strReplace(ws, '\xA5', ' ');
    ws = L.strReplace(ws, '\xA2', '<');
    ws = L.strReplace(ws, '\xA3', '>');
    ws = L.strReplace(ws, '\xA1', '"');
    ws = L.strReplace(ws, '\xA4', '\'');
    ws = L.strReplace(ws, '\xA7', 'à');
    ws = L.strReplace(ws, '\xA8', 'è');
    ws = L.strReplace(ws, '\xA9', 'é');
    ws = L.strReplace(ws, '\xAA', 'ë');
    ws = L.strReplace(ws, '\xAB', 'ō');
    ws = L.strReplace(ws, '\xB0', '-');
    ws = L.strReplace(ws, '\xBB', ' ');

    while (ws.includes('  ')) // Erasing all but one whitespace from strings
        ws = L.strReplace(ws, '  ', ' ');

    ws = L.re.sub(ws, String.raw`<(.*?)<(.*?)>`, '$1');
    buffer.fromWA(ws);
}

function LucaSystemFilter1(buffer, hp) {
    LucaSystemFilter(buffer, hp);
    // 秋&冬  官中
    L.StringReplacerA(buffer, '\x82\xa1', '\xa3\xac'); // ，
    L.StringReplacerA(buffer, '\x82\xa3', '\xa1\xa3'); // 。
    L.StringReplacerA(buffer, '\x82\xa5', '\xa1\xa2'); // 、
    L.StringReplacerA(buffer, '\x83\x48', '\xa1\xb1'); // ”
    L.StringReplacerA(buffer, '\x83\x44', '\xa3\xbf'); // ？
    L.StringReplacerA(buffer, '\x83\x42', '\xa3\xa1'); // !
    L.StringReplacerA(buffer, '\x82\xa7', '\xa1\xb9'); // 」
    L.StringReplacerA(buffer, '\x82\xc1', '\xa1\xb7'); // 》
    L.StringReplacerA(buffer, '\x83\x46', '\xa1\xaf'); // ’
}

// template <int arg> SpecialHookigi
function SpecialHookigi(arg) {
    return (context, hp, buffer, split) => {
        const Src = context.stack[arg];
        const Size = context.stack[arg + 1];
        const len = L.strlen(Src);
        if (len <= 2) return;
        if (len >= Size) return;
        if (len < ((Size - 4) >>> 0)) return;
        buffer.fromCharPtr(Src);
    };
}

function IGScript1attach_function() {
    /*
     * FLOWERS
     * https://vndb.org/v15395 v14267 v18152 r82704
     */
    const bytes = [
        // memcpy(dst,src,size)
        0x81, 0xf9, 0x00, 0x01, 0x00, 0x00,
        0x72, XX,
        0x83, 0x3d, ...XX4, 0x00,
        0x74, XX,
        0x57, 0x56,
        0x83, 0xe7, 0x0f,
        0x83, 0xe6, 0x0f,
        0x3b, 0xfe];
    const module = L.GetModuleHandleW('Script.dll');
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    let addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    if (!addr) return false;
    const funcstart = [0x55, 0x8b, 0xec, 0x57, 0x56];
    const insertgbk = L.MatchPattern(addr, funcstart);
    let succ = L.NewHook({ address: addr, text_fun: SpecialHookigi(2), type: L.NO_CONTEXT, filter_fun: LucaSystemFilter }, 'LucaSystem');

    if (insertgbk) {
        // 仅官中适用这个过滤器。日语原版不需要过滤
        succ = L.NewHook({ address: addr + 5, text_fun: SpecialHookigi(5), type: L.NO_CONTEXT, filter_fun: LucaSystemFilter1 }, 'LucaSystem_chs') || succ;
    }
    return succ;
}

function InsertLucaSystemHook() {
    /*
     * Sample games: https://vndb.org/v15395 v14267 v18152 r82704
     */
    const bytes = [
        0xCC,                   // int 3
        0xE9, ...XX4,           // jmp d3d9.dll+1E420
        0x56,                   // push esi
        0x57,                   // push edi
        0x8B, 0x7C, 0x24, 0x20, // mov edi,[esp+20]
        0x8B, 0xD8,             // mov ebx,eax
        0x8B, 0x07              // mov eax,[edi]
    ];
    const bytes2 = [
        0xCC,             // int 3
        0x83, 0xEC, 0x0C, // sub esp,0C      <- hook here
        0x53,             // push ebx
        0x55,             // push ebp
        0x56              // push esi
    ];
    const module = L.GetModuleHandleW('Script.dll');
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    let addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) {
        addr = L.findBytes(bytes2, minAddress, maxAddress);
        if (!addr) return false;
    }
    return L.NewHook({
        address: addr + 1,
        offset: L.stackoffset(1),
        padding: 0x04,
        type: L.USING_STRING,
        filter_fun: LucaSystemFilter,
    }, 'LucaSystem');
}

const E = L.engine({
    name: 'LucaSystem',
    check: () => L.GetModuleHandle('Script.dll') && L.CheckFile('*.iga'),
    certain: false,
    attach() {
        let b1 = IGScript1attach_function();
        b1 = InsertLucaSystemHook() || b1;
        return b1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
