// Abel.js: LunaHook's Abel engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Abel.cpp and Abel.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// AbelSoftware hook: the game folder usually is made up of many files without an extension, with the
// game name as a common prefix and 2 digits in order. Sample game オタカ, hooked address 0x4413b0
// (text in arg1, painted character by character).
function InsertAbelHook() {
    // jichi: If this pattern failed again, try the following pattern instead:
    // 894424 48        MOV DWORD PTR SS:[ESP+0x48],EAX
    // 894424 4C        MOV DWORD PTR SS:[ESP+0x4C],EAX
    // 894424 58        MOV DWORD PTR SS:[ESP+0x58],EAX
    const character = [...L.le32(0xc981d48a), ...L.le32(0xffffff00)];
    let j = L.findBytes(character, L.processStartAddress, L.processStopAddress);
    if (j) {
        for (const i = j - 0x100; j > i; j--) {
            if (L.u16(j) === 0xff6a) {
                return L.NewHook({
                    address: j,
                    offset: L.stackoffset(1),
                    type: L.USING_STRING | L.NO_CONTEXT,
                    filter_fun(buffer) {
                        if (buffer.size === 1 && buffer.data[0] === 0x0a) buffer.clear();
                    },
                }, 'Abel');
            }
        }
    }
    return false;
}

const E = L.engine({
    name: 'Abel',
    // Artikash 6/15/2018 removed the "*01" file-info detection; only these remain
    check: () => L.CheckFileAll(['system', 'system.dat']) || L.CheckFile('*01'),
    files: ['*01'],
    certain: false,
    attach() { return InsertAbelHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
