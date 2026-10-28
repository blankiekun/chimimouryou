// CoffeeMaker.js: LunaHook's CoffeeMaker engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/CoffeeMaker.cpp and CoffeeMaker.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function CoffeeMaker_attach_function() {
    // https://vndb.org/v4025
    // みになびVGA
    let addr = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, true, 0x1d); // mov ebx, ds:GetGlyphOutlineA
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_CHAR | L.DATA_INDIRECT, offset: L.stackoffset(3) }, 'CoffeeMaker');
}

function CoffeeMaker_attach_function2() {
    // https://vndb.org/v4025
    // こころナビ
    const bytes = [
        0x55, 0x8B, 0xEC, 0x57, 0x56, 0x8B, 0x75, 0x0C, 0x8B, 0x4D, 0x10, 0x8B, 0x7D, 0x08, 0x8B, 0xC1,
        0x8B, 0xD1, 0x03, 0xC6, 0x3B, 0xFE, 0x76, 0x08, 0x3B, 0xF8, 0x0F, 0x82, ...XX4,
        0xF7, 0xC7, 0x03, 0x00, 0x00, 0x00, 0x75, XX, 0xC1, 0xE9, 0x02, 0x83, 0xE2, 0x03, 0x83, 0xF9, 0x08];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1), // regoffset(ecx); void *__cdecl memcpy(void *a1, const void *Src, size_t Size)
        type: L.USING_STRING,
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.strReplace(s, String.raw`\w\w\w`); // a literal removal, as in the C++
            buffer.fromA(s);
        },
    }, 'CoffeeMaker');
}

const E = L.engine({
    name: 'CoffeeMaker',
    check: { FILE_ALL: ['VIC.EPK', 'MUS.EPK', 'SE.EPK', 'CG.EPK', 'SCR.EPK'] },
    attach() {
        // C++ `|` runs both
        const a = CoffeeMaker_attach_function2();
        return CoffeeMaker_attach_function() || a;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
