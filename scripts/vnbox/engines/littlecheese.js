// littlecheese.js: LunaHook's littlecheese engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/littlecheese.cpp and littlecheese.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function littlecheeseattach_function() {
    // 黒と金の開かない鍵
    // if ( a3 == 33088 ): cmp edx, 8140h
    const bytes81 = [
        0x81, 0xFA, 0x40, 0x81, 0x00, 0x00, 0x75];
    let addr = L.findBytes(bytes81, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const align = [0x83, 0xC4]; // add esp xxx
    addr = L.reverseFindBytes(align, addr - 0x100, addr);
    if (!addr) return false;
    const hp = {
        offset: L.regoffset('ecx'),
        filter_fun(buffer) {
            L.StringFilterA(buffer, '\x81\x40');
        },
    };
    if (L.u32(addr - 4) === 0x55575653) {
        hp.address = addr - 4;
        hp.type = L.USING_CHAR | L.CODEC_ANSI_BE;
    } else {
        hp.address = addr;
        hp.split = L.regoffset('edx');
        hp.type = L.USING_CHAR | L.CODEC_ANSI_BE | L.NO_CONTEXT | L.USING_SPLIT;
    }
    return L.NewHook(hp, 'littlecheese');
}

function Rufattach_function() {
    const bytes = [
        // 奴隷市場Renaissance
        0x81, XX, 0x00, 0x01, 0x00, 0x00,
        0x8B, 0xF0,
        0x76, 0x07,
        0x81, 0x6D, 0xF4, 0x00, 0x80, 0x00, 0x00];
    const bytes2 = [
        // セイレムの魔女たち
        0x81, XX, 0x00, 0x01, 0x00, 0x00,
        0x76, 0x07,
        0x81, 0x6D, 0xF4, 0x00, 0x80, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) addr = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.CODEC_ANSI_BE }, 'Ruf');
}

const E = L.engine({
    name: 'littlecheese',
    check: { FILE: '*.bmx' },
    certain: false,
    attach() {
        let _ = littlecheeseattach_function();
        if (L.CheckFileAll(['*.arc', '*.scb', '*.wsm']) || L.GetModuleHandle('Kagura.dll')) {
            _ = Rufattach_function() || _;
        }
        return _;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
