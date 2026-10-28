// Escude.js: LunaHook's Escude engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Escude.cpp and Escude.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// Left out: hook_before, HookArgument and embed_fun (roles and embedding): LunaHook overwrites hp.text_fun
// with SpecialHookEscude, so hook_before never runs. IsBadWritePtr is IsBadReadPtr here (VNBox cannot
// probe writability).

function EscudeFilter(buffer) {
    let s = buffer.strA();
    s = L.strReplace(s, '<r>', '\n');
    s = L.re.sub(s, '<ruby(.*?)>(.*?)</ruby>', '$2');
    buffer.fromA(s);
}

function _escudeltrim(text) {
    if (text && L.u8(text) === 0x3c) // '<'
        for (let p = text; L.u8(p) > 0 && L.u8(p) < 0x80; p++) // (signed char)*p > 0
            if (L.u8(p) === 0x3e) // '>'
                return p + 1;
    return text;
}

function SpecialHookEscude(context, hp, buffer, split) {
    const arg1 = context.stack[1];
    if (!arg1 || arg1 === 0xffffffff || L.IsBadReadPtr(arg1, 4)) // this is indispensable
        return;
    let text = L.u32(arg1 + 0x20);
    if (!text || L.IsBadReadPtr(text, 1) || !L.u8(text)) // this is indispensable
        return;
    text = _escudeltrim(text);
    if (!text)
        return;
    split.value = L.u32(arg1);
    buffer.fromCharPtr(text);
}

function InsertEscudeHook() {
    const bytes = [
        0x76, 0x0a, // 0042cb9c   76 0a            jbe short .0042cba8
        0x49, // 0042cb9e   49               dec ecx
        0x0f, 0xaf, 0x48, 0x0c]; // 0042cb9f   0faf48 0c        imul ecx,dword ptr ds:[eax+0xc]
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        return false;
    }
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) {
        return false;
    }
    return L.NewHook({
        address: addr,
        text_fun: SpecialHookEscude,
        filter_fun: EscudeFilter,
        type: L.USING_STRING | L.USING_SPLIT | L.NO_CONTEXT, // NO_CONTEXT as this function is only called by one caller anyway
        lineSeparator: '<r>',
    }, 'Escude');
}

const E = L.engine({
    name: 'Escude',
    check: { FILE_ALL: ['configure.cfg', 'gfx.bin'] },
    attach() { return InsertEscudeHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
