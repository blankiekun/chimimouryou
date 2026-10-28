// GASTRO.js: LunaHook's GASTRO engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GASTRO.cpp and GASTRO.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function filter(buffer) {
    let s = buffer.strA();
    s = L.re.sub(s, '#(.*?)#');
    s = L.strReplace(s, '\\c');
    buffer.fromA(s);
}

function GASTRO_attach_function1() {
    // https://vndb.org/v4052
    const bytes = [
        // char *__cdecl strncpy(char *Destination, const char *Source, size_t Count)
        0x8B, 0x4C, 0x24, 0x0C,
        0x57,
        0x85, 0xC9,
        0x74, XX,
        0x56,
        0x53,
        0x8B, 0xD9, 0x8B,
        0x74, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: filter }, 'GASTRO');
}

function GASTRO_attach_function2() {
    // https://vndb.org/v15103
    const bytes = [
        // _WORD *__cdecl sub_40EC00(unsigned __int8 *a1, _WORD *a2, _WORD *a3, _WORD *a4)
        // v4 = *a1; if ( (*a1 < 0x81u || v4 > 0x9Fu) && (v4 < 0xE0u || v4 > 0xFCu) )
        0x8b, 0x54, 0x24, 0x04,
        0x8a, 0x02,
        0x3c, 0x81,
        0x72, XX,
        0x3c, 0x9f,
        0x76, XX,
        0x3c, 0xe0,
        0x72, XX,
        0x3c, 0xfc];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if ((addrs.length !== 3) || ((addrs[0] = L.findEnclosingAlignedFunction(addrs[0])) === 0)) return false;
    // embed flags left out (translation embedding)
    return L.NewHook({ address: addrs[0], offset: L.stackoffset(2), type: L.USING_STRING, filter_fun: filter }, 'GASTRO');
}

const E = L.engine({
    name: 'GASTRO',
    check: { FILE_ALL: ['BMPDATA.ARC', 'MIDDATA.ARC', 'SCRDATA.ARC', 'SYSDATA.ARC'] },
    certain: false,
    attach() { return GASTRO_attach_function2() || GASTRO_attach_function1(); },
});

module.exports = E;
if (!module.parent) L.run(E);
