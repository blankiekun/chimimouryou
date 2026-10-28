// ONScripterru.js: LunaHook's ONScripterru engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ONScripterru.cpp and ONScripterru.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const MAX_REL_ADDR = 0x00300000;

function ONScripterruCommonFilter(buffer) {
    L.StringCharReplacerA(buffer, '{n}', ' ');
    if (buffer.strA().includes('{c:')) L.StringFilterBetweenA(buffer, '{c:', ':');
    if (buffer.strA().includes('{e:')) L.StringFilterBetweenA(buffer, '{e:', ':');
    if (buffer.strA().includes('{f:')) L.StringFilterBetweenA(buffer, '{f:', ':');
    if (buffer.strA().includes('{i:')) L.StringFilterA(buffer, '{i:');
    if (buffer.strA().includes('{p:')) L.StringFilterBetweenA(buffer, '{p:', '}');
    L.CharFilterA(buffer, '}');
    if (buffer.strA().includes('[')) L.StringFilterBetweenA(buffer, '[', ']');
}

function ONScripterru1Filter(buffer) {
    const text = buffer.strA();
    if (text[0] === ':' || text[1] === '{') return buffer.clear();
    ONScripterruCommonFilter(buffer);
    L.CharFilterA(buffer, '`');
}

function InsertONScripterruHook1() {
    /*
     * Sample games:
     * Umineko Project (all text displayed)
     */
    const bytes = [
        0x90, // nop
        0x55, // push ebp   << hook here
        0x57, // push edi
        0x31, 0xED, // xor ebp,ebp
        0x56, // push esi
        0x53, // push ebx
        0x83, 0xEC, 0x3C, // sub esp,3C
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 1,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun: ONScripterru1Filter,
    }, 'ONScripter-RU1');
}

// keep what lies between the first two backticks (the C++ dereferences null when there is none; here the text stays)
function StringBetween(buffer, fr, to) {
    const s = buffer.strA();
    const start = s.indexOf(fr);
    if (start < 0) return;
    const from = start + fr.length;
    const end = s.indexOf(to, from);
    if (end < 0) return;
    buffer.fromA(s.substring(from, end));
}

function ONScripterru2Filter(buffer) {
    StringBetween(buffer, '`', '`');
    ONScripterruCommonFilter(buffer);
}

function InsertONScripterruHook2() {
    /*
     * Sample games:
     * Umineko Project (partial text displayed)
     */
    const bytes = [
        0x0F, 0xB6, 0x04, 0x18, // movzx eax,byte ptr [eax+ebx]   << hook here
        0x89, 0x74, 0x24, 0x04, // mov [esp+04],esi
        0x43, // inc ebx
        0x89, 0x44, 0x24, 0x08, // mov [esp+08],eax
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        split: L.regoffset('esi'),
        type: L.USING_STRING | L.CODEC_UTF8 | L.USING_SPLIT | L.KNOWN_UNSTABLE,
        filter_fun: ONScripterru2Filter,
    }, 'ONScripter-RU2');
}

const E = L.engine({
    name: 'ONScripterru',
    check: () => L.SearchResourceString('ONScripter-RU') || L.SearchResourceString('onscripter-ru.exe'),
    attach() {
        const ok = InsertONScripterruHook1();
        return InsertONScripterruHook2() || ok;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
