// Majiro.js: LunaHook's Majiro engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Majiro.cpp and Majiro.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 12/28/2014: new Majiro hook pattern
 *  Old Majiro: caller pattern sub esp (0x81,0xec); new Majiro: push ebp / mov ebp,esp / sub esp,*
 *  Old majiro: arg3 is text, arg1 is font name. New majiro: arg3 is text, arg4 is font name.
 *  In the old Majiro game, caller's address could be used as split.
 */

// These values are the same as the assembly logic of ITH:
//     ([eax+0x28] & 0xff) | (([eax+0x48] >> 1) & 0xffffff00)
// 0x28 = 10 * 4, 0x48 = 18 / 4
function MajiroOldFontSplit(arg) { // arg is supposed to be a string, though
    return ((L.u32(arg + 4 * 10) & 0xff) | ((L.u32(arg + 4 * 18) >>> 1) & 0xffffff00)) >>> 0;
}

// Remove lower bytes use 0xffffff00, which are different for furigana
function MajiroNewFontSplit(arg) { // arg is supposed to be a string, though
    return ((L.u32(arg + 4 * 12) & 0xff) | (L.u32(arg + 4 * 16) & 0xffffff00)) >>> 0;
}

function SpecialHookMajiro(context, hp, buffer, split) {
    const arg3 = context.stack[3]; // text
    buffer.fromCharPtr(arg3);
    // IsBadReadPtr is not needed for old Majiro game.
    // I am not sure if it is needed by new Majiro game.
    if (hp.user_value) { // new majiro
        const arg4 = context.stack[4]; // old majiro
        if (arg4) split.value = MajiroNewFontSplit(arg4);
        else split.value = L.u32(context.base + 0x5c); // = 4 * 23, caller's caller
    } else {
        const arg1 = context.stack[1]; // old majiro
        if (arg1) split.value = MajiroOldFontSplit(arg1);
    }
}

function InsertMajiroHook() {
    // jichi 4/19/2014: There must be a function in Majiro game which contains 6 TextOutA.
    // That function draws all texts.
    // jichi 11/28/2014: Add new function signature
    const funcs = [
        // caller patterns
        0xec81,     // sub esp = 0x81,0xec byte old majiro
        0x83ec8b55, // mov ebp,esp, sub esp,*  new majiro

        0x5348ec83
        // sub     esp, 48h, push    ebx
        // MOON CHILDe
        // https://vndb.org/v1568
    ];
    const addr = L.findMultiCallerAddress(L.FindFunction('TextOutA'), funcs, funcs.length, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;

    const newMajiro = 0x55 === L.u8(addr);
    const checknew = [
        0x8D, 0x04, 0x8D, 0x00, 0x00, 0x00, 0x00,
        0x8B, 0x4D, 0x08,
        0x89, 0x45, XX,
        0x89, 0x4d, XX,
        0x38, 0x19,
        0x0f, 0x84, ...XX4];
    const isverynew = newMajiro && L.findBytes(checknew, addr, addr + 0x300);
    if (isverynew) {
        // https://vndb.org/r128573
        // みずいろリメイク
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'Majiro2Ex');
    }
    const hp = { address: addr, text_fun: SpecialHookMajiro, user_value: newMajiro ? 1 : 0 };
    if (newMajiro) {
        hp.type = L.NO_CONTEXT; // do not use return address for new majiro
        return L.NewHook(hp, 'Majiro2');
    }
    return L.NewHook(hp, 'Majiro');
}

function InsertMajiroHook3x() {
    const bytes = [
        0x8b,
        0x08,
        0x0f,
        0xbf,
        0x19,
        0x83,
        0xc1,
        0x02,
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 8,
        offset: L.regoffset('ecx'),
        type: L.USING_STRING | L.NO_CONTEXT,
        // https://vndb.org/v17376
        // 私が好きなら「好き」って言って！
        text_fun(context, hp, buffer, split) {
            const str = context.ecx;
            buffer.fromCharPtr(str);
            if (L.u8(str) === 0x81 && L.u8(str + 1) === 0x79) split.value = 0;
            else split.value = 1;
        },
    }, 'majiro3');
}

function InsertMajiro2Hookx() {
    // Scarlett～スカーレット～
    const bytes = [0x83, 0xE2, 0x03, 0x03, 0xC2, 0xC1, 0xF8, 0x02, 0x81, 0xF9, 0x00, 0x01, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'majiro4');
}

function InsertMajiro3Hook() {
    /*
     * Sample games: Narcissu 10th Anniversary Anthology Project
     * https://vndb.org/v10 v70 v18738 v18739 v18736
     */
    const bytes = [
        0xC1, 0xE9, 0x02, // shr ecx,02     << hook here
        0xF3, 0xA5,       // repe movsd
        0x8B, 0xCA,       // mov ecx,edx
        0x8D, 0x95, ...XX4 // lea edx,[ebp-00000404]
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('esi'), type: L.USING_STRING }, 'Majiro3');
}

const E = L.engine({
    name: 'Majiro',
    check: () => L.CheckFile('data*.arc') &&
        (L.CheckFile('stream*.arc') || L.CheckFileAll(['scenario*.arc', 'fastdata*.arc', 'data*.arc', 'voice*.arc'])),
    certain: false,
    attach() {
        const b1 = InsertMajiroHook();
        const b2 = InsertMajiroHook3x();
        const b3 = InsertMajiro2Hookx();
        const b4 = InsertMajiro3Hook();
        return b1 || b2 || b3 || b4;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
