// Live.js: LunaHook's Live engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Live.cpp and Live.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: InsertLiveDynamicHook (a trigger_fun that was commented out in LunaHook too).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function InsertLiveHook() {
    const ins = [0x64, 0x89, 0x20, 0x8b, 0x45, 0x0c, 0x50];
    const addr = L.findBytes(ins, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('edx'), type: L.CODEC_ANSI_BE }, 'Live');
}

let live2last = ''; // static std::string last
function live2() {
    const ins = [
        // CODE:0017D697 xor eax,eax / mov al,[ebp+var_5] / cmp eax,0AAh / ja default / jmp jpt_17D6A7[eax*4]  (171 cases)
        // case 50 (0x32) of the jump table:
        // lea edx,[ebp+var_54] / mov eax,ebx / mov ecx,[eax] / call [ecx+240h] / mov edx,[ebp+var_54]  <--- edx
        0x33, 0xc0,
        0x8a, 0x45, XX,
        0x3d, 0xaa, 0x00, 0x00, 0x00,
        0x0f, 0x87, ...XX4,
        0xff, 0x24, 0x85, ...XX4];
    const addr = L.findBytes(ins, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const jmptable = L.u32(addr + ins.length - 4);
    const target = L.u32(jmptable + 4 * 0x32);
    const CHECKOK = [
        0x8d, 0x55, XX,
        0x8b, 0xc3,
        0x8b, 0x08,
        0xff, 0x91, ...XX4,
        0x8b, 0x55, XX];
    if (!L.MatchPattern(target, CHECKOK)) return false;
    const Trim = (t) => t.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
    return L.NewHook({
        address: target + CHECKOK.length,
        offset: L.regoffset('edx'),
        type: L.USING_STRING | L.NO_CONTEXT,
        filter_fun(buffer) {
            const s = buffer.strA();
            if (L.startWith(s, live2last)) {
                const _ = s.substr(live2last.length);
                buffer.fromA(Trim(_));
            } else {
                buffer.fromA(Trim(s));
            }
            live2last = s;
        },
    }, 'Live2');
}

const E = L.engine({
    name: 'Live',
    check: { FILE: 'live.dll' },
    attach() {
        return InsertLiveHook() | live2();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
