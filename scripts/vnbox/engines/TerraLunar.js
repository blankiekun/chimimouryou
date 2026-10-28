// TerraLunar.js: LunaHook's TerraLunar engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/TerraLunar.cpp and TerraLunar.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

function H1() {
    const bytes = [
        // らくえん～あいかわらずなぼく。の場合～
        0x8A, 0x08,
        0x81, 0xF9, 0x9F, 0x00, 0x00, 0x00,
        0x7E];
    const addrs = L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress);
    let succ = false;
    for (const addr of addrs) {
        succ = L.NewHook({
            address: addr,
            offset: L.regoffset('eax'),
            type: L.USING_STRING,
            filter_fun(buffer) { L.StringFilterA(buffer, '[w]'); },
        }, 'TerraLunar') || succ;
    }
    return succ;
}

function H2() {
    const bytes = [
        // https://vndb.org/v2416
        // ナースのお勉強 応用編～受けシチュ以外は絶対禁止！～
        0X8B, 0X4D, 0X0C, 0X0F, 0XBE, 0X51, 0X01, 0XB8, 0X00, 0X01, 0X00, 0X00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'AtelierD');
}

const E = L.engine({
    name: 'TerraLunar',
    check: { FILE: 'data_script.pac' },
    attach() {
        const h2 = H2();
        const h1 = H1(); // `|`: both run
        return h2 || h1;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
