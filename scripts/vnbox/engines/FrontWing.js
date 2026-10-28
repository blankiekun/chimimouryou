// FrontWing.js: LunaHook's FrontWing engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/FrontWing.cpp and FrontWing.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'FrontWing',
    check: { RESOURCE_STR: 'FrontWing Co.,LTD.' },
    attach() {
        const bytes = [
            // v55 = (int)(__CFADD__(v54 * v13, 0x80000000) + v54 * v13 + 0x80000000 + 0x80000000) >> 1;
            0x05, 0x00, 0x00, 0x00, 0x80, 0x15, 0x00, 0x00, 0x00, 0x80, 0xD1, 0xF8, 0x85, 0xC0];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        let faddr = L.findEnclosingAlignedFunction(addr);
        if (!faddr) faddr = L.findfuncstart(addr, 0x240);
        if (!faddr) return false;
        return L.NewHook({ address: faddr, offset: L.stackoffset(1), type: L.USING_STRING }, 'FrontWing');
    },
});

function FrontWing2_attach_function() {
    const bytes = [
        0x68, 0xb4, 0x00, 0x00, 0x00,
        0x6a, 0x00,
        0x8b, 0x55, 0x08,
        0x81, 0xc2, ...XX4,
        0x52,
        0xe8, ...XX4,
        0x83, 0xc4, 0x0c,
        0x68, 0xb3, 0x00, 0x00, 0x00,
        0x8b, 0x45, 0x08,
        0x8b, 0x88, ...XX4,
        0x03, 0x4d, 0xfc,
        0x51,
        0x8b, 0x55, 0x08,
        0x81, 0xc2, ...XX4,
        0x52,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + bytes.length - 5,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING,
        filter_fun(buffer) {
            const __ = L.strSplit(buffer.strA(), '\n');
            let s = '';
            for (let i = 0; (i < __.length) && (__[i].length > 1); i++) {
                s += __[i];
            }
            let ws = L.StringToWideString(s, 932);
            ws = L.strReplace(ws, '\r');
            ws = L.re.sub(ws, String.raw`[\w\d]*\\[\w\d]*\\[\w\d_]*`);
            ws = L.re.sub(ws, String.raw`\[rb,(.*?),(.*?)\]`, '$1');
            ws = L.re.sub(ws, ',(.*?),(.*?)', '$1$2');
            buffer.fromWA(ws);
        },
    }, 'FrontWing');
}

let last = ''; // static std::string last

function FrontWing2_attach_function2() {
    const bytes = [
        0x8b, 0x55, 0xf8,
        0x03, 0x55, 0x10,
        0x03, 0x55, XX,
        0x8b, 0x45, 0x0c,
        0x0f, 0xbe, 0x0c, 0x10,
        0x83, 0xf9, 0x0d,
        0x75, XX,
        0x8b, 0x55, 0xf8,
        0x03, 0x55, 0x10,
        0x03, 0x55, XX,
        0x8b, 0x45, 0x0c,
        0x0f, 0xbe, 0x4c, 0x10, 0x01,
        0x83, 0xf9, 0x0a,
        0x75, XX,
        0x8b, 0x55, 0xf8,
        0x03, 0x55, 0x10,
        0x03, 0x55, XX,
        0x8b, 0x45, 0x0c,
        0x0f, 0xbe, 0x4c, 0x10, 0x02,
        0x83, 0xf9, 0x0d,
        0x75, XX,
        0x8b, 0x55, 0xf8,
        0x03, 0x55, 0x10,
        0x03, 0x55, XX,
        0x8b, 0x45, 0x0c,
        0x0f, 0xbe, 0x4c, 0x10, 0x03,
        0x83, 0xf9, 0x0a,
        0x74, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING,
        filter_fun(buffer) {
            const xx = buffer.viewA();
            if (xx === last) return buffer.clear();
            last = xx;
        },
    }, 'FrontWing');
}

const E2 = L.engine({
    name: 'FrontWing2',
    check: { FILE_ALL: ['MDT\\*.dat', 'BGM.dat', 'CHIP.dat', 'ef.dat', 'Init.dat', 'SE.dat'] },
    attach() { return FrontWing2_attach_function() || FrontWing2_attach_function2(); },
});

module.exports = [E, E2];
if (!module.parent) { L.run(E); L.run(E2); }
