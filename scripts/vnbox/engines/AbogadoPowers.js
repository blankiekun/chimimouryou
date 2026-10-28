// AbogadoPowers.js: LunaHook's AbogadoPowers engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AbogadoPowers.cpp and AbogadoPowers.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;

const E = L.engine({
    name: 'AbogadoPowers',
    // the files alone do not pass this check (&&), so no `files` hint for the page
    check: () => L.CheckFileAll(['*.dsk', '*.pal', '*.pft', '*.fnt']) && L.SearchResourceString('AbogadoPowers / Scarecrow'),
    attach() {
        const bytes = [
            0xa1, ...XX4,
            0x33, 0xc9,
            0x8a, 0x08,
            0x85, 0xc9,
            0x0f, 0x84, ...XX4,
            0xe8, ...XX4,
            0x85, 0xc0];
        const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            user_value: L.u32(addr + 1), // the global holding the text pointer (mov eax, [user_value])
            text_fun(context, hp, buffer) {
                buffer.from(L.u32(hp.user_value), 2);
            },
            filter_fun(buffer) {
                if (buffer.data[0] === '_'.charCodeAt(0)) return buffer.clear();
                if (buffer.data[0] === 0) return buffer.clear();
            },
        }, 'AbogadoPowers');
    },
});

module.exports = E;
if (!module.parent) L.run(E);
