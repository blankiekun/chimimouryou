// Alice.js: LunaHook's Alice engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Alice.cpp and Alice.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// System40 is a game engine developed by Alicesoft. Pattern 1: SACTDX.dll or SACT2.dll exports SP_TextDraw;
// pattern 2: *engine.dll exports SP_SetTextSprite.

// InsertAliceHook1 (SP_TextDraw) is left out: it walks the function prologue with LunaHook's length
// disassembler (::disasm) to find the first one-byte register push, and libLuna has no disassembler.

function InsertAliceHook2(addr) {
    if (!addr) return false;
    const hp = { address: addr };
    const bytes = [0x8b, 0x4d, 0x0c];
    const bytes2 = [0x8b, 0x01,
        0x3d, ...XX4,
        0x0f, 0x85, ...XX4,
        0x83, 0x79, 0x18, 0x10,
        0x8d, 0x51, 0x04,
        0x72, 0x02,
        0x8b, 0x12];
    let addr1 = L.findBytes(bytes, addr, addr + 0x20);
    if (addr1) addr1 = L.findBytes(bytes2, addr1, addr1 + 0x20);
    if (addr1) {
        // Rance 02 英文版: a CStringWrapper (vftable, then a TextUnionA: text/chars at 0, size at 0x10, capacity at 0x14)
        hp.type = L.USING_STRING;
        hp.text_fun = (context, hp, buffer, split) => {
            const u = context.stack[2] + 4; // TextUnionA *
            const size = L.u32(u + 0x10), capacity = L.u32(u + 0x14);
            buffer.from(capacity < 0x10 ? u : L.u32(u), size);
        };
    } else {
        hp.offset = L.regoffset('eax');
        hp.index = 0x8;
        hp.type = L.DATA_INDIRECT;
    }
    return L.NewHook(hp, 'System40');
}

// jichi 8/23/2013 Move here from engine.cc
// Do not work for the latest Alice games
// jichi 5/13/2015: Looking for function entries in StoatSpriteEngine.dll
function InsertAliceHook() {
    let ok = false;
    // SP_TextDraw: InsertAliceHook1 left out (see above)
    const addr = L.FindFunction('SP_SetTextSprite');
    if (addr) { // Artikash 6/27/2018 not sure if this works
        ok = InsertAliceHook2(addr) || ok;
    }
    return ok;
}

function Sys42VM() {
    // https://vndb.org/r41279
    // Beat Blades Haruka
    const vm = L.GetModuleHandle('Sys42VM.dll');
    if (!vm) return false;
    const [s, e] = L.QueryModuleLimits(vm);
    const sig = [
        0x51, 0x56,
        0x8b, 0xf0,
        0x8b, 0x46, 0x04,
        0x85, 0xc0,
        0x74, 0x07,
        0x8b, 0x4e, 0x08,
        0x2b, 0xc8,
        0x75, 0x05,
        0xe8, ...XX4,
        0x8b, 0x76, 0x04,
        0x56,
        0x8b, 0x74, 0x24, 0x10,
        0xe8, ...XX4,
        0x5e, 0x59,
        0xc2, 0x04, 0x00];
    const addr = L.findBytes(sig, s, e);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.FULL_STRING | L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            const a1 = context.eax;
            const v3 = L.u32(a1 + 4);
            if (!v3 || L.u32(a1 + 8) === v3) return;
            buffer.fromCharPtr(v3);
        },
        filter_fun(buffer) {
            if (buffer.viewA().endsWith('.asd')) buffer.clear();
        },
    }, 'System42');
}

let hooked = false;

const E = L.engine({
    name: 'Alice',
    // LunaHook's check hooks the game (attach_function_) and its attach_function does nothing
    check: () => {
        const a = InsertAliceHook();
        hooked = Sys42VM() || a;
        return hooked;
    },
    attach() { return hooked; }, // C++ returns true; the check passes only once a hook is in
});

module.exports = E;
if (!module.parent) L.run(E);
