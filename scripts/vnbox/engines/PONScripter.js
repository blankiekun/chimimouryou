// PONScripter.js: LunaHook's PONScripter engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/PONScripter.cpp and PONScripter.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;
const MAX_REL_ADDR = 0x00300000;

function InsertPONScripterHook() {
    const str = L.findBytes(L.aToBytes('CBString::Failure in (CBString'), L.processStartAddress, L.processStopAddress);
    if (str) {
        const calledAt = L.findBytes(L.le32(str), L.processStartAddress, L.processStopAddress);
        if (calledAt) {
            // funcs[] = {0xec8b55, 0xe58955}: push ebp; mov ebp,esp (two encodings), 3 bytes each
            let addr = L.findBytes([0x55, 0x8b, 0xec], calledAt - 0x100, calledAt);
            if (!addr) addr = L.findBytes([0x55, 0x89, 0xe5], calledAt - 0x100, calledAt);
            if (addr) {
                return L.NewHook({
                    address: addr,
                    type: L.USING_STRING | L.CODEC_UTF8 | L.DATA_INDIRECT,
                    offset: L.stackoffset(1),
                    index: 0xc,
                }, 'PONScripter');
            }
        }
    }
    return false;
}

let prevText = ''; // static std::string prevText
function PONScripterFilter(buffer) {
    let text = buffer.strA();
    const m = text.search(/[\^@\\\n]/);
    if (m >= 0) {
        text = text.substring(0, m);
        buffer.fromA(text);
    }
    if (prevText === text) return buffer.clear();
    prevText = text;

    // StringFilter(buffer, "#", 7): remove '#' and the 6 chars after it
    let s = buffer.strA();
    for (let at = s.indexOf('#'); at >= 0; at = s.indexOf('#', at)) s = s.slice(0, at) + s.slice(at + 7);
    buffer.fromA(s);
}

function InsertPONScripterEngHook() {
    /*
     * Sample games:
     * https://vndb.org/v24770
     */
    const bytes = [
        0x89, 0xD0, // mov eax,edx
        0x8D, 0x75, 0xD8, // lea esi,[ebp-28]
        0x89, 0x55, 0xB4, // mov [ebp-4C],edx
        0x83, 0xC0, 0x01, // add eax,01
        0x89, 0x45, 0xC0, // mov [ebp-40],eax    << hook here
    ];
    const addr_offset = bytes.length - 3;
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('eax'),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun: PONScripterFilter,
    }, 'PONScripterEng');
}

function InsertPONScripterJapHook() {
    /*
     * Sample games:
     * https://vndb.org/v24770
     */
    const bytes = [
        0x8D, 0x87, ...XX4, // lea eax,[edi+00000198]               << hook here
        0x8B, 0x0D, ...XX4, // mov ecx,[ciconia_phase1.exe+3D82C0]
        0x89, 0x55, 0xB4, // mov [ebp-4C],edx
        0xC6, 0x45, 0xAE, 0x00, // mov byte ptr [ebp-52],00
        0x89, 0x45, 0xA4, // mov [ebp-5C],eax
        0x8B, 0x01, // mov eax,[ecx]
        0x8B, 0x75, 0xB4, // mov esi,[ebp-4C]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        type: L.USING_STRING | L.CODEC_UTF8,
        filter_fun: PONScripterFilter,
    }, 'PONScripterJap');
}

function pons() {
    /*
    int __thiscall sub_46A3C0(int *this, void *a2, int a3)
    {
      result = sub_460780(this + 1, a2, a3); <--findbytes+xref
      if ( result == -1 )
        sub_684AC0("CBString::Failure in concatenate", (int)&v5);
      ...
    */
    const bytes = [
        0x55, 0x57, 0x56, 0x53,
        0x83, 0xec, XX,
        0x8b, 0x5c, 0x24, XX,
        0x8b, 0x7c, 0x24, XX,
        0x8b, 0x74, 0x24, XX,
        0x85, 0xdb,
        0x0f, 0x84, ...XX4,
        0x8b, 0x43, 0x08,
        0x85, 0xc0,
        0x89, 0x44, 0x24, 0x0c,
        0x0f, 0x84, ...XX4,
        0x8b, 0x43, 0x04,
        0x85, 0xc0,
        0x78, XX,
        0x8b, 0x13,
        0x39, 0xd0,
        0x7f, XX,
        0x85, 0xd2,
        0x7e, XX,
        0x85, 0xff,
        0x8d, 0x76, 0x00,
        0x74, XX,
        0x89, 0xf5,
        0xc1, 0xed, 0x1f];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addrs.length !== 1) return false;
    for (addr = addrs[0]; (addrs[0] - addr < 0x30) && (L.u8(addr) !== 0x55); addr -= 1);
    if (L.u8(addr) !== 0x55) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_CHAR | L.CODEC_UTF8 | L.DATA_INDIRECT,
    }, 'PONScripter2');
}

const E = L.engine({
    name: 'PONScripter',
    check: () => L.CheckFile('arc.nsa') && (L.SearchResourceString('Proportional ONScripter') || L.SearchResourceString('Ponscripter') || L.SearchResourceString('ponscr.exe')),
    attach() {
        const ok = InsertPONScripterEngHook() && InsertPONScripterJapHook();
        return ok || (pons() || InsertPONScripterHook()); // If a language hook is missing, the original code is executed
    },
});

module.exports = E;
if (!module.parent) L.run(E);
