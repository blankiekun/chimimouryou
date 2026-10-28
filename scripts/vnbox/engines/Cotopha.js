// Cotopha.js: LunaHook's Cotopha engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Cotopha.cpp and Cotopha.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// ScenarioHook::Private::hookBefore (the text_fun of hook 1). Left out: the role guess (Engine::…Role from
// stack values) and attachCaller, whose hook (hookAfterCaller) writes eax with the text size.
function hookBefore(s, hp, buffer) {
    const text = s.stack[1]; // arg1
    if (!text || !L.u16(text))
        return;

    if (L.readW(text) === '----/--/-- --:--')
        return;

    buffer.fromWCharPtr(text);
}

function CotophaFilter(buffer) {
    const text = buffer.strW();
    const n = text.length;

    if (buffer.size <= 2 || text[0] !== '\\')
        return buffer.clear();

    const c = (i) => (i < n ? text.charCodeAt(i) : 0);
    const out = [];
    for (let i = 0; i < n; i++) {
        if (text[i] !== '\\') {
            out.push(text[i]);
        } else {
            const cmd = text[++i];
            if (cmd === 'r') { // ruby
                i++; // skip ';' char
                while (c(++i) !== 0x3a && i < n) { // ':'
                    if (text[i] === ';') // when we reach '; ' we have the kanji part
                        break;
                    out.push(text[i]);
                }
            } else if (cmd === 'n' && out.length) // newline
                out.push(' '); // for Western language compatibility
            while (c(++i) !== 0x3a && i < n);
        }
    }
    if (out.length)
        out.push(' '); // for Western language compatibility
    buffer.fromW(out.join(''));
}

function InsertCotophaHook1() {
    const funcs = [
        0xec8b55,
        0xdc8b53, // バカップル・サプリメント体験版
        0x0000a164]; // こんねこ
    const addr = L.findMultiCallerAddress(L.FindFunction('GetTextMetricsA'), funcs, funcs.length, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.regoffset('ebp'),
        type: L.CODEC_UTF16 | L.USING_SPLIT | L.USING_STRING | L.NO_CONTEXT,
        text_fun: hookBefore,
    }, 'Cotopha');
}

function InsertCotophaHook2() {
    const eslHeapFree = L.GetProcAddress(L.GetModuleHandle(null), 'eslHeapFree');
    const eslHeapGetLength = L.GetProcAddress(L.GetModuleHandle(null), 'eslHeapGetLength');
    if (!(eslHeapFree && eslHeapGetLength))
        return false;
    // Left out: the hook on eslHeapFree reads the block's length by calling the game's eslHeapGetLength
    // (a call into the guest); VNBox cannot call guest functions.
    return false;
}

function InsertCotophaHook3() {
    const bytes = [0x8B, 0x75, 0xB8, 0x8B, 0xCE, 0x50, 0xC6, 0x45, 0xFC, 0x01, 0xE8];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr)
        return false;

    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF16 | L.USING_STRING,
        offset: L.regoffset('eax'),
    }, 'Cotopha3_EWideString');
}

function InsertCotophaHook4() {
    const bytes = [
        0xCC, // int 3
        0x55, // push ebp     << hook here
        0x8B, 0xEC, // mov ebp,esp
        0x51, // push ecx
        0x53, // push ebx
        0x56, // push esi
        0x57, // push edi
        0x8B, 0x7D, 0x08, // mov edi,[ebp+08]
        0x33, 0xF6, // xor esi,esi
        0x8B, 0xD9, // mov ebx,ecx
        0x85, 0xFF, // test edi,edi
        0x74, 0x0D]; // je ststeady2.glsGetEnabledProcessorType+643F

    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr)
        return false;

    return L.NewHook({
        address: addr + 1,
        offset: L.stackoffset(1),
        type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
        filter_fun: CotophaFilter,
    }, 'Cotopha4');
}

function h5() {
    const bytes = [
        0x8b, 0x45, XX,
        0x0f, 0xb7, 0x50, XX,

        0xb8, 0x41, 0x00, 0x00, 0x00,
        0x66, 0x3b, 0xd0,
        0x66, 0xb8, 0x5a, 0x00,
        0x1b, 0xc9,
        0x41,
        0x66, 0x3b, 0xc2,
        0x1b, 0xc0,
        0x40,
        0x85, 0xc8,

        0x75, XX,

        0xb8, 0x61, 0x00, 0x00, 0x00,
        0x66, 0x3b, 0xd0,
        0x66, 0xb8, 0x7a, 0x00,
        0x1b, 0xc9,
        0x41,
        0x66, 0x3b, 0xc2,
        0x1b, 0xc0,
        0x40,
        0x85, 0xc8];

    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    const check = [
        0x66, 0x90,
        0x40,
        0x66, 0x83, 0x3c, 0x42, 0x00,
        0x75, XX];
    const check2 = [0x8d, 0x45, 0xf4];
    let addrx = L.findBytes(check, addr, addr + 0x100);
    if (!addrx)
        return false;
    addrx = L.findBytes(check2, addr, addrx);
    if (!addrx)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(3), type: L.CODEC_UTF16 | L.USING_STRING }, 'Cotopha5');
}

function InsertCotophaHook() {
    const _old = InsertCotophaHook1();
    const h4 = InsertCotophaHook4();
    const h3 = InsertCotophaHook3();
    const _ = (h4 || h3) || InsertCotophaHook2() || h5();
    if (!_)
        L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineW'));
    return _ || _old;
}

const E = L.engine({
    name: 'Cotopha',
    check: { FILE_ANY: ['*.noa', 'data\\*.noa'] },
    attach() { return InsertCotophaHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
