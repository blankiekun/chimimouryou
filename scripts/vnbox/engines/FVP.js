// FVP.js: LunaHook's FVP engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/FVP.cpp and FVP.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// ScenarioHook (EmbedFVP): the embed flags and embed_hook_font are left out, the text hook stays.
function ScenarioHookAttach(startAddress, stopAddress) {
    const bytes = [
        0x53, // 00433657   53               push ebx
        0xeb, 0x06, // 00433658   eb 06            jmp short .00433660
        0x8d, 0x9b, 0x00, 0x00, 0x00, 0x00]; // 0043365a   8d9b 00000000    lea ebx,dword ptr ds:[ebx]
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (addr)
        addr = L.findEnclosingFunctionBeforeDword(0x550cec83, addr, L.MaximumFunctionSize, 1);

    if (!addr) {
        const check = [
            0x99,
            0x83, 0xe2, 0x1f,
            0x03, 0xc2,
            0xbe, 0x01, 0x00, 0x00, 0x00,
            0xc1, 0xf8, 0x05,
            0xd3, 0xe6];
        if (L.findBytes(check, startAddress, stopAddress)) {
            addr = L.FindFunction('lstrlenA');
        }
    }
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.FULL_STRING,
        filter_fun(buffer) {
            buffer.fromWA(L.re.sub(buffer.strAW(), '\\[.+?\\|(.+?)\\]', '$1'));
        },
    }, 'EmbedFVP');
}

const E = L.engine({
    name: 'FVP',
    check: { FILE: '*.hcb' },
    certain: false,
    attach() {
        if (!ScenarioHookAttach(L.processStartAddress, L.processStopAddress))
            return false;
        return true;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
