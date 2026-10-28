// solfasys.js: LunaHook's solfasys engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/solfasys.cpp and solfasys.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function solfasys1() {
    let addr = L.findCallerAddressAfterInt3(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findShortJumpAddress(addr, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x10); // actually only 2
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addrs.length !== 2) return false;
    addr = addrs[0];
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_ANSI_BE | L.USING_CHAR, offset: L.stackoffset(1) }, 'solfasys');
}

function solfasys2() {
    // https://vndb.org/v5173
    // Princess Fortissimo
    let addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const addrs = L.findxref_reverse_checkcallop(addr, L.processStartAddress, L.processStopAddress, 0xe8);
    if (addrs.length !== 2) return false;
    addr = addrs[1]; // 仅这作是第一个，其他作都是第二个
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.CODEC_ANSI_BE | L.USING_CHAR, offset: L.stackoffset(1) }, 'solfasys');
}

// https://vndb.org/v5183 朝っぱらから発情家族, https://vndb.org/v5175 ななちゃんといっしょ
const E = L.engine({
    name: 'solfasys',
    check: () => L.SearchResourceString('Solfa Novel System') || L.SearchResourceString('Solfa Standard Novel System'),
    certain: false,
    attach() { return solfasys1() || solfasys2(); },
});

module.exports = E;
if (!module.parent) L.run(E);
