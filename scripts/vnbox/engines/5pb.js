// 5pb.js: LunaHook's _5pb and _5pb_2 engines for VNBox (libLuna.js runs them).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/5pb.cpp and 5pb.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// hookmages::MAGES() (LunaHook/engines/mages) is left out: it is a separate engine family libLuna does not have.

// jichi 12/2/2014 5pb. Sample game: CROSS CHANNEL FINAL COMPLETE.
// Characters to ignore: [%0-9A-Z]
function Insert5pbHook1() {
    const bytes = [
        0xcc,            // int3
        0xcc,            // int3
        0x8b, 0x15, ...XX4, // mov edx,dword ptr ds:[0x66e2b78]
        0x8a, 0x0a,      // mov cl,byte ptr ds:[edx]  ; jichi: hook here
        0x33, 0xc0,      // xor eax,eax
        0x84, 0xc9       // test cl,cl
    ];
    const addr_offset = 0x0016d916 - 0x0016d90e;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('edx'), type: L.USING_STRING }, '5pb1');
}

// Characters to ignore: [%@A-z]
function _5pb2garbage_ch(c) {
    return c === 0x25 || c === 0x40 || (c >= 0x41 && c <= 0x7a);
}

// mov dl,byte ptr ds:[eax]  ; jichi: here, word by word
let lasttext = 0; // static DWORD lasttext
function SpecialHook5pb2(context, hp, buffer, split) {
    const text = context.eax;
    if (lasttext === text) return;
    const c = L.u8(text);
    if (!c) return;
    const size = L.IsDBCSLeadByteEx(932, c) ? 2 : 1; // ::LeadByteTable[c]
    if (size === 1 && _5pb2garbage_ch(c)) return;
    lasttext = text;
    buffer.from(text, size);
}

function Insert5pbHook2() {
    const bytes = [
        0x8a, 0x10, // mov dl,byte ptr ds:[eax]
        0x84, 0xd2, // test dl,dl
        0x74, 0x11  // je short
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING | L.NO_CONTEXT, text_fun: SpecialHook5pb2 }, '5pb2');
}

// jichi 2/2/2015: New 5pb hook. Sample game: Hyperdimension.Neptunia.ReBirth1
// Text in arg1, name in arg2
function SpecialHook5pb3(context, hp, buffer, split) {
    const index = 0;
    let text = context.stack[index + 1];
    if (text && L.u8(text)) {
        if (index) // trim spaces in character name
            while (L.u8(text) === 0x20) text++;
        let sz = L.strlen(text);
        if (index)
            while (sz && L.u8(text + sz - 1) === 0x20) sz--;
        split.value = (L.FIXED_SPLIT_VALUE << index) >>> 0;
        buffer.from(text, sz);
    }
}
function Insert5pbHook3() {
    const bytes = [
        // function starts
        0x55,             // push ebp
        0x8b, 0xec,       // mov ebp,esp
        0x56,             // push esi
        0xff, 0x75, 0x0c, // push dword ptr ss:[ebp+0xc]
        0x8b, 0xf1,       // mov esi,ecx
        0xff, 0x75, 0x08, // push dword ptr ss:[ebp+0x8]
        0x8d, 0x46, 0x08, // lea eax,dword ptr ds:[esi+0x8]
        0x50,             // push eax
        0xe8              // call
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun: SpecialHook5pb3,
        filter_fun: L.NewLineCharToSpaceA, // replace '\n' by ' '
    }, '5pb3');
}

// https://store.steampowered.com/app/589530/Hakuoki_Kyoto_Winds/
function hook4name() {
    const bytes = [
        0x55, 0x8b, 0xec,
        0x51,
        0x53,
        0x8b, 0x5d, 0x08,
        0x85, 0xdb,
        0x0f, 0x84, ...XX4,
        0x8b, 0x4d, 0x0c,
        0x8d, 0x53, XX,
        0x56,
        0x57,
        0x83, 0xcf, 0xff,
        0x33, 0xf6,
        0x8d, 0x49, 0x00,
        0x3b, 0x4a, 0xf8,
        0x74, XX,
        0x85, 0xff,
        0x79, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING | L.CODEC_UTF8, offset: L.stackoffset(3) }, '5pb4');
}
function hook4text() {
    const bytes = [
        0x55, 0x8b, 0xec,
        0xb8, 0x14, 0x10, 0x00, 0x00,
        0xe8, ...XX4,
        0xa1, ...XX4,
        0x33, 0xc5,
        0x89, 0x45, 0xfc,
        0x56,
        0x8b, 0x75, 0x08,
        0x8d, 0x85, ...XX4,
        0x57,
        0x68, 0xff, 0x0f, 0x00, 0x00,
        0x6a, 0x00,
        0x50,
        0x8b, 0xf9,
        0xc6, 0x85, ...XX4, 0x00,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.CODEC_UTF8,
        offset: L.stackoffset(1),
        filter_fun(buffer) {
            L.StringCharReplacerA(buffer, '#n', ' ');
            L.StringFilterA(buffer, '#I');
        },
    }, '5pb4');
}
function hook4() {
    return hook4name() && hook4text();
}

function Insert5pbHook() {
    let ok = Insert5pbHook1();
    ok = Insert5pbHook2() || ok;
    ok = Insert5pbHook3() || ok;
    return ok || hook4();
}

function Insert5pbHookex() {
    // 祝姬
    const bytes = [0x0F, 0xB6, 0xC2, 0x35, 0xC5, 0x9D, 0x1C, 0x81];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const start = [0x55, 0x8b, 0xec, 0x83, 0xe4];
    addr = L.reverseFindBytes(start, addr - 0x40, addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('ecx'), type: L.CODEC_UTF16 }, '5pb');
}

function InsertStuffScriptHook() {
    // BOOL GetTextExtentPoint32(HDC hdc, LPCTSTR lpString, int c, LPSIZE lpSize)
    return L.NewHook({
        address: L.FindFunction('GetTextExtentPoint32A'),
        offset: L.stackoffset(2), // arg2 lpString
        split: L.regoffset('esp'),
        type: L.USING_STRING | L.USING_SPLIT,
    }, 'StuffScriptEngine');
}
function StuffScript2Filter(buffer) {
    if (buffer.viewA()[0] === '-') {
        L.StringFilterA(buffer, '-/-');
        L.StringFilterBetweenA(buffer, '-', '-');
    }
    L.StringCharReplacerA(buffer, '_n_r', '\n');
    L.StringCharReplacerA(buffer, '_r', ' ');
    L.StringFilterA(buffer, '\\n');
    L.StringFilterA(buffer, '_n');
}
function InsertStuffScript2Hook() {
    // Sample games: https://vndb.org/r41537 https://vndb.org/r41539
    const bytes = [
        0x0F, XX, ...XX4,    // jne tokyobabel.exe+3D4E8
        0xB9, ...XX4,        // mov ecx,tokyobabel.exe+54EAC
        0x8D, 0x85, ...XX4,  // lea eax,[ebp+tokyobabel.exe+59B968]
        0x8A, 0x10,       // mov dl,[eax]                         <-- hook here
        0x3A, 0x11,       // cmp dl,[ecx]
        0x75, 0x1A,       // jne tokyobabel.exe+3D1D7
        0x84, 0xD2,       // test dl,dl
        0x74, 0x12,       // je tokyobabel.exe+3D1D3
        0x8A, 0x50, 0x01, // mov dl,[eax+01]
        0x3A, 0x51, 0x01, // cmp dl,[ecx+01]
        0x75, 0x0E,       // jne tokyobabel.exe+3D1D7
        0x83, 0xC0, 0x02, // add eax,02
        0x83, 0xC1, 0x02, // add ecx,02
        0x84, 0xD2,       // test dl,dl
        0x75, 0xE4,       // jne Agreement.exe+4F538
        0x33, 0xC0,       // xor eax,eax
        0xEB, 0x05,       // jmp Agreement.exe+4F55D
        0x1B, 0xC0,       // sbb eax,eax
        0x83, 0xD8, 0xFF, // sbb eax,-01
        ...L.XX2,         // cmp eax,edi
        0x0F, 0x84, ...XX4 // je tokyobabel.exe+3D4E8
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 0x11,
        offset: L.regoffset('eax'),
        index: 0,
        type: L.USING_STRING | L.NO_CONTEXT,
        filter_fun: StuffScript2Filter,
    }, 'StuffScript2');
}
function StuffScript3Filter(buffer) {
    L.StringFilterBetweenA(buffer, '/\x81\x79', '\x81\x7A'); // remove hidden name
    L.StringFilterBetweenA(buffer, '[', ']'); // garbage

    // ruby
    L.CharFilterA(buffer, '<');
    L.StringFilterBetweenA(buffer, ',', '>');

    L.StringFilterA(buffer, '_r\x81\x40');
    L.StringFilterA(buffer, '_r');
}
function InsertStuffScript3Hook() {
    // Sample games: https://vndb.org/v3111
    const bytes = [
        0xCC,                  // int 3
        0x81, 0xEC, ...XX4,       // sub esp,00000140          <-- hook here
        0xA1, ...XX4,             // mov eax,[EVOLIMIT.exe+8C1F0]
        0x33, 0xC4,            // xor eax,esp
        0x89, 0x84, 0x24, ...XX4, // mov [esp+0000013C],eax
        0x53,                  // push ebx
        0x55,                  // push ebp
        0x8B, 0xAC, 0x24, ...XX4, // mov ebp,[esp+0000014C]
        0x8B, 0x45, 0x2C       // mov eax,[ebp+2C]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 1,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING | L.NO_CONTEXT,
        filter_fun: StuffScript3Filter,
    }, 'StuffScript3');
}
function StuffScript_hook1() {
    // https://vndb.org/v445 Bullet Butlers
    const aSSS = L.findBytes(L.aToBytes('%s%s%s\0'), L.processStartAddress, L.processStopAddress);
    if (!aSSS) return false;
    const pushasss = L.find_leaorpush_addr_all(aSSS, L.processStartAddress, L.processStopAddress);
    if (pushasss.length !== 3) return false;
    if (pushasss[1] - pushasss[0] > 0x40) return false;
    const bytes = [
        0x8a, 0x11,
        0x88, 0x14, 0x08,
        0x41,
        0x84, 0xd2,
        0x75, 0xf6];
    let addr = L.reverseFindBytes(bytes, pushasss[0] - 0x400, pushasss[0]);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x180);
    if (!addr) return false;
    // the main screen could embed, but history then crashes the game (LunaHook gave up on embedding)
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: StuffScript3Filter }, 'StuffScript4');
}
function StuffScript_attach_function() {
    let _ = StuffScript_hook1() || InsertStuffScriptHook();
    _ = InsertStuffScript2Hook() || _;
    _ = InsertStuffScript3Hook() || _;
    return _;
}

function _5pb_attach() {
    const b1 = Insert5pbHook();
    const b2 = Insert5pbHookex();
    const b3 = false; // hookmages::MAGES(), see the top
    const sf = StuffScript_attach_function();
    return b1 || b2 || b3 || sf;
}

function KaleidoFilter(buffer) {
    // Unofficial eng TL with garbage newline spaces
    L.StringFilterA(buffer, ' \\n ');
    L.StringFilterA(buffer, ' \\n');
    L.StringFilterA(buffer, '\\n');
    L.StringCharReplacerA(buffer, '\xEF\xBC\x9F', '?');
    let s = buffer.strA();
    s = L.re.sub(s, '#[0-9a-f]{6};(.*?)%r', '$1');
    s = L.re.sub(s, '%t\\d+;');
    buffer.fromA(s);
}

function InsertKaleidoHook() {
    // Sample games: https://vndb.org/v29889
    const bytes = [
        0xFF, 0x75, 0xD4,      // push [ebp-2C]
        0xE8, ...XX4,             // call 5toubun.exe+1DD0
        0x83, 0xC4, 0x0C,      // add esp,0C
        0x8A, 0xC3,            // mov al,bl
        0x8B, 0x4D, 0xF4,      // mov ecx,[ebp-0C]
        0x64, 0x89, 0x0D, ...XX4, // mov fs:[00000000],ecx
        0x59                   // pop ecx          << hook here
    ];
    const addr_offset = bytes.length - 1;
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('esi'),
        index: 0,
        split: L.stackoffset(3),
        split_index: 0,
        type: L.USING_STRING | L.USING_SPLIT | L.CODEC_UTF8,
        filter_fun: KaleidoFilter,
    }, 'Kaleido');
}

// ANONYMOUS;CODE 官中
function __1() {
    const bytes = [0x8d, 0x45, 0xf4, 0x64, 0xA3, 0x00, 0x00, 0x00, 0x00, 0x8b, 0xf1, 0x8a, 0x46, 0x2c, 0x8b, 0x55, 0x08, 0x84, 0xc0, 0x74, 0x04, 0x32, 0xc0];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // EMBED_ABLE | EMBED_AFTER_NEW left out
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.CODEC_UTF8, lineSeparator: '\\n' }, '5bp');
}
function __() {
    const sig1 = [0x81, 0xFE, 0xF0, 0x00, 0x00, 0x00];
    const sig2 = [0x81, 0xFE, 0xF8, 0x00, 0x00, 0x00];
    const sig3 = [0x81, 0xFE, 0xFC, 0x00, 0x00, 0x00];
    const sig4 = [0x81, 0xFE, 0xFE, 0x00, 0x00, 0x00];
    const sig5 = [0x81, 0xFE, 0x80, 0x00, 0x00, 0x00];
    const sig6 = [0x81, 0xFE, 0xE0, 0x00, 0x00, 0x00];
    const addr_hit = new Map();
    for (const sig of [sig1, sig2, sig3, sig4, sig5, sig6]) {
        for (let addr of L.SearchMemory(sig, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            addr_hit.set(addr, (addr_hit.get(addr) || 0) + 1);
        }
    }
    let addr = 0;
    let m = 0;
    for (const [a, n] of addr_hit) {
        if (n > m) {
            m = n;
            addr = a;
        }
    }
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING | L.CODEC_UTF8, filter_fun: KaleidoFilter }, '5bp');
}
function __2() {
    // レヱル・ロマネスク origin 多国語版 https://vndb.org/r119877
    // char __thiscall sub_426B70(float *this, int a2, int a3, int a4, int a5, char a6, char a7)
    const bytes = [
        0x0f, 0xb7, 0x04, 0x72,
        0x46,
        0x89, 0x85, ...XX4,
        0x0f, 0xb7, 0xc0,
        0x83, 0xc0, 0xf6,
        0x83, 0xf8, 0x52,
        0x0f, 0x87];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction_strict(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.stackoffset(2),
        // EMBED_ABLE | EMBED_AFTER_NEW left out
        type: L.USING_SPLIT | L.USING_STRING | L.FULL_STRING | L.CODEC_UTF16,
        filter_fun(buffer) {
            // そうして、[おひとよ,2]御一夜――\n眼下に広がるこの町も、僕を間違いなく救ってくれた。
            // 「なるほど。それゆえ、御一夜は衰退し、\n\x%lエアクラ;#00ffc040;エアクラ%l;#;工場の誘致話が持ち上がったわけか？」
            let xx = buffer.strW();
            xx = L.re.sub(xx, String.raw`\[(.*?),\d\]`, '$1');
            xx = L.re.sub(xx, String.raw`\\x%l(.*?);(.*?);(.*?);#;`, '$1');
            buffer.fromW(xx);
        },
        lineSeparator: '\\n',
    }, '5bp');
}
function _5pb_2_attach() {
    let ___1 = __1() || __();
    ___1 = __2() || ___1;
    return InsertKaleidoHook() || ___1;
}

const E1 = L.engine({
    name: '_5pb',
    check: { FILE_ANY: ['data\\*.cpk', '*.cpk', '*.mpk', 'USRDIR\\*.mpk'] },
    certain: false,
    attach() { return _5pb_attach(); },
});
const E2 = L.engine({
    name: '_5pb_2',
    check: { FILE: 'windata/script_body.bin' },
    certain: false,
    attach() { return _5pb_2_attach(); },
});

module.exports = [E1, E2];
if (!module.parent) L.run([E1, E2]);
