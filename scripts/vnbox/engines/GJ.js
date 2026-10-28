// GJ.js: LunaHook's GJ engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/GJ.cpp and GJ.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const E = L.engine({
    name: 'GJ',
    check: { FILE_ALL: ['back.usi', 'battle.usi', 'bgm.usi', 'intermission.usi', 'scenario.usi', 'status.usi', 'system.usi', 'title.usi'] },
    attach() {
        // int sscanf(const char *const Buffer, const char *const Format, ...)
        //->
        // int __cdecl _scanner(int (__cdecl *a1)(int), void (__cdecl *a2)(int, int), int a3, char *a4, int a5)
        const bytes = [
            0x80, 0x7d, 0xe7, 0x25,
            0x75, 0x0f,
            0x8a, 0x17,
            0x47,
            0x88, 0x55, 0xe7,
            0x80, 0xfa, 0x25,
            0x0f, 0x85, ...XX4];
        let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        addr = L.findfuncstart(addr);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            text_fun(context, hp, buffer, split) {
                let s = L.readA(L.u32(context.stack[3])); // *(char **)stack[3]
                if (!s.startsWith('name ') && !s.startsWith('main ')) return;
                split.value = s.charCodeAt(0);
                s = s.substr(5);
                s = L.strReplace(s, '@n');
                buffer.fromA(s);
            },
        }, 'GJ');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
