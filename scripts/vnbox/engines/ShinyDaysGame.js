// ShinyDaysGame.js: LunaHook's ShinyDaysGame engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ShinyDaysGame.cpp and ShinyDaysGame.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

/** Game-specific engines */
// TextUnionW (pack 4): union { wchar_t *text; wchar_t chars[8]; } at 0, size at 0x10, capacity at 0x14.
const textUnionW = (p) => ({
    at: L.u32(p + 0x14) < 8 ? p : L.u32(p),
    size: L.u32(p + 0x10),
});

let ShinyDaysText = ''; // text_buffer (as UTF-16 text) and ShinyDaysQueueStringLen of the C++

function SpecialGameHookShinyDays(context, hp, buffer) {
    let text = '';
    const fun_str = L.readW(context.stack[0x13]);
    const esi = (context.stack[0x1C] + 0x3C) >>> 0;
    const edi = context.stack[0x1D];
    if (esi <= edi) {
        const tu = textUnionW(esi);
        text = L.readW(tu.at, tu.size);
    }
    if (fun_str === '[PlayVoice]') {
        buffer.fromW(ShinyDaysText);
    } else if (fun_str === '[PrintText]') {
        ShinyDaysText = text;
    }
}

function InsertShinyDaysGameHook() {
    const bytes = [
        0xff, 0x83, 0x70, 0x03, 0x00, 0x00, 0x33, 0xf6,
        0xc6, 0x84, 0x24, 0x90, 0x02, 0x00, 0x00, 0x02];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 0x8,
        text_fun: SpecialGameHookShinyDays,
        type: L.CODEC_UTF16 | L.USING_STRING | L.NO_CONTEXT,
        filter_fun(buffer) { L.StringCharReplacerW(buffer, '\\n', '\n'); },
    }, 'ShinyDays');
}

const E = L.engine({
    name: 'ShinyDaysGame',
    check: () => L.processName_lower.includes('shinydays') || L.processName_lower.startsWith('shinyd~') || L.CheckFile('ShinyDays.exe'),
    files: ['ShinyDays.exe'],
    attach() { return InsertShinyDaysGameHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
