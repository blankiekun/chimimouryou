// Erogos.js: LunaHook's Erogos engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Erogos.cpp and Erogos.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function h1() {
    // らぶフェチ～手コキ編～
    // TextOutA需要调整文字速度为最快才能正确提取，这个不需要，比较完美。
    const bytes = [
        // v4 = v1; v5 = byte_451BE0[v1];
        // for ( byte_461CE2 = 0; v5; ++dword_461D0C ) { v1 += 2; word_461D10[12 * v3] = v5 + ((unsigned __int8)byte_451BE1[v4] << 8);
        0x66, 0x0f, 0xb6, 0x80, ...XX4,
        0x66, 0x0f, 0xb6, 0xc9,
        0x8d, 0x14, 0x52,
        0x66, 0x83, 0xc6, 0x02,
        0xc1, 0xe0, 0x08,
        0x03, 0xc1,
        0x66, 0x89, 0x04, 0xd5, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + bytes.length - 8, offset: L.regoffset('eax'), type: L.USING_CHAR }, 'Erogos2');
}

const E = L.engine({
    name: 'Erogos',
    check: { FILE_ALL: ['ags.exe', 'bg.dat', 'bgm.dat', 'mov.dat', 'script.dat', 'voice.dat'] },
    certain: false,
    attach() {
        // らぶフェチ ～マゾ編～
        // らぶフェチ～千聡編～
        const hp = {
            address: L.FindFunction('TextOutA'),
            type: L.USING_STRING | L.USING_SPLIT,
            split: L.stackoffset(4),
            offset: L.stackoffset(4),
            length_offset: 5,
        };
        return h1() || L.NewHook(hp, 'Erogos');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
