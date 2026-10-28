// ADVSystem.js: LunaHook's ADVSystem engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ADVSystem.cpp and ADVSystem.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function name() {
    const sig = [
        0X53,
        0X55,
        0X8B, 0X6C, 0X24, 0X10,
        0X56,
        0X8B, 0XF0,
        0X8A, 0X1E,
        0X84, 0XDB,
        0X74, XX,
        0X57,
        0X0F, 0XB6, 0XFB,
        0X57,
        0X83, 0XC6, 0X01,
        0XE8, ...XX4,
        0X83, 0XC4, 0X04,
        0X85, 0XC0,
        0X75, XX,
        0XF6, 0X87, ...XX4, 0X04,
        0X74, XX,
        0X8A, 0XE3,
        0X83, 0XC6, 0X01,
        0X8A, 0X46, 0XFF,
        0XEB, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // embed flags and embed_hook_font left out (translation embedding)
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.USING_STRING | L.NO_CONTEXT }, 'ADVSystem');
}

function prolog() {
    const sig = [
        0x80, 0X7E, 0X08, 0X00,
        0X8B, 0X7E, 0X0C,
        0X89, 0X06,
        0X0F, 0X85, ...XX4,
        0X8B, 0X4E, 0X10,
        0X8A, 0X04, 0X39,
        0X83, 0XC1, 0X01,
        0X84, 0XC0,
        0X89, 0X4E, 0X10,
        0X74, XX,
        0X3C, 0X0A,
        0X74, XX,
        0X3C, 0X0D,
        0X74, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // embed_fun and embed flags left out (translation embedding)
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun(context, hp, buffer, split) {
            const a1 = context.esi;
            const v5 = L.u32(a1 + 12);
            const v6 = L.u32(a1 + 16);
            if (v6) return;
            buffer.fromCharPtr(v5);
        },
        filter_fun(buffer) {
            const s = buffer.strA();
            buffer.fromA(L.strReplace(s, '\r\n', '\n'));
        },
    }, 'ADVSystem');
}

function text() {
    const sig = [
        0X83, 0XBF, 0X2C, 0X03, 0X00, 0X00, 0X00,
        0X8B, 0X8F, 0XA8, 0X02, 0X00, 0X00,
        0X8B, 0X59, 0X04,
        0X0F, 0X85, ...XX4,
        0X80, 0X7F, 0X30, 0X00,
        0X0F, 0X85, ...XX4,
        0X8B, 0X87, 0XB4, 0X02, 0X00, 0X00,
        0X8A, 0X14, 0X18,
        0X8D, 0X48, 0X01,
        0X0F, 0XB6, 0XC2,
        0X83, 0XF8, 0X24,
        0X89, 0X8F, 0XB4, 0X02, 0X00, 0X00,
        0X0F, 0X87, ...XX4];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // embed_fun and embed flags left out (translation embedding); hasl was only read by embed_fun
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun(context, hp, buffer, split) {
            const a1 = context.edi;
            const v4 = L.u32(L.u32(a1 + 680) + 4);
            const v5 = L.u32(a1 + 692);
            if (v5) return;
            buffer.fromCharPtr(v4);
        },
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.strReplace(s, '\r\n', '\n');
            if (s.endsWith('$L')) s = s.substr(0, s.length - 2);
            buffer.fromA(s);
        },
    }, 'ADVSystem');
}

const E = L.engine({
    name: 'ADVSystem',
    check: () => L.CheckFileAll(['*.PK', '*.PK0', '*.PKA', '*.PKB', '*.PKC']) &&
        L.SearchResourceString('U-Me SOFT') &&
        L.SearchResourceString('ADV System 1.75.romance'),
    attach() {
        // クラブ・ロマンスへようこそ
        return prolog() && text() && name();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
