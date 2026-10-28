// Aksys.js: LunaHook's Aksys engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Aksys.cpp and Aksys.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function _Aksys() {
    // https://vndb.org/v25385
    // Spirit Hunter: NG
    // int __usercall sub_4CDD70@<eax>(const char *a1@<edx>, int a2, _DWORD *a3, int *a4): strlen, then
    // sub_4CAF70(0, 0, 0x3A4u, a1, 0xFDE9u) converts the string to UTF-8
    const bytes = [
        0x68, 0xe9, 0xfd, 0, 0,
        0x56,
        0x68, 0xa4, 0x03, 0, 0,
        0x33, XX,
        0x33, XX,
        0xe8];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        split: L.regoffset('edx'),
        type: L.USING_STRING | L.USING_SPLIT,
        filter_fun(buffer) {
            L.StringFilterA(buffer, '@1r');
            L.StringFilterA(buffer, '@-1r');
            // StringToWideString(...).has_value(): libLuna's decoder is not fatal, bad bytes become U+FFFD
            if (L.StringToWideString(buffer.viewA(), 932).includes('�')) buffer.clear();
        },
    }, 'Aksys');
}

const E = L.engine({
    name: 'Aksys',
    check: { FILE: 'System.bra' },
    certain: false,
    attach() {
        return _Aksys();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
