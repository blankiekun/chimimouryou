// SystemAoi.js: LunaHook's SystemAoi engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/SystemAoi.cpp and SystemAoi.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

// Left out: SpecialHookSystemAoi, GetSystemAoiVersion and InsertSystemAoiDynamicHook (all of them are
// only used by the dynamic hook, a trigger_fun on DrawTextExA/W and GetGlyphOutlineW that VNBox has no
// equivalent of), AgsPatchA (it rewrites the game's text pointer for embedding), the after-functions (embedding).
// LunaHook's attach_function returns true even when it found no Ags*.dll; the port returns whether a
// static hook was added (the GDI hooks, which the dynamic part installs, are the fallback anyway).

function findAoiProc(hModule, functionName, minParamNum = 0, maxParamNum = 10) {
    for (let i = minParamNum; i < maxParamNum; i++) {
        const sig = '_' + functionName + '@' + String(4 * i); // function signature name, such as _AgsSpriteCreateText@20
        const proc = L.GetProcAddress(hModule, sig);
        if (proc) return proc;
    }
    return 0;
}

// skip leading quotes: returns the address of the first character to read
function ltrimA(text) {
    for (const q of ['<>', '[]']) {
        while (L.u8(text) === q.charCodeAt(0)) {
            const idx = L.readA(text).indexOf(q[1]);
            if (idx >= 0) {
                text = text + idx + 1;
                if (L.u8(text) === 0x81 && L.u8(text + 1) === 0x40) text += 2; // skip 　 leading space, assuming sjis encoding
            } else {
                break;
            }
        }
    }
    return text;
}

function ltrimW(text) {
    for (const q of ['<>', '[]']) {
        while (L.u16(text) === q.charCodeAt(0)) {
            const idx = L.readW(text).indexOf(q[1]);
            if (idx >= 0) {
                text = text + (idx + 1) * 2;
                if (L.u16(text) === 0x3000) text += 2; // skip 　 leading space
            } else {
                break;
            }
        }
    }
    return text;
}

function beforeAgsSpriteCreateTextExW(s, hp, buffer) {
    let text = s.stack[2]; // arg2
    if (!text || !L.isAddressReadable(text) || !L.u16(text)) return;
    text = ltrimW(text);
    if (!L.u16(text)) return;
    buffer.fromWCharPtr(text);
}

function beforeAgsSpriteCreateTextW(s, hp, buffer) {
    let text = s.stack[1]; // arg1
    if (!text || !L.isAddressReadable(text) || !L.u16(text)) return; // skip modifying readonly text in code region
    // containsTags and the split (0x63a1 name, 0x639e scenario) only chose the role
    text = ltrimW(text);
    if (!L.u16(text)) return;
    buffer.fromWCharPtr(text);
}

function beforeAgsSpriteCreateTextA(s, hp, buffer) {
    let text = s.stack[1]; // arg1
    if (!text || !L.isAddressReadable(text) || !L.u8(text)) return; // skip modifying readonly text in code region
    // the split (0x639d name, 0x639c scenario) only chose the role
    text = ltrimA(text);
    if (!L.u8(text)) return;
    buffer.fromCharPtr(text);
}

function InsertSystemAoiStatic(hModule, wideChar) { // attach scenario
    const addr = findAoiProc(hModule, 'AgsSpriteCreateText', 1);
    if (!addr) return false;
    const hp = {
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.NO_CONTEXT,
    };
    let succ = false;
    if (wideChar) {
        hp.type |= L.CODEC_UTF16;
        hp.text_fun = beforeAgsSpriteCreateTextW;
        succ = L.NewHook(hp, 'SystemAoiW') || succ;

        const addrEx = findAoiProc(hModule, 'AgsSpriteCreateTextEx', 1);
        if (addrEx) {
            succ = L.NewHook({
                address: addrEx,
                offset: L.stackoffset(2),
                type: L.CODEC_UTF16,
                text_fun: beforeAgsSpriteCreateTextExW,
            }, 'SystemAoiExW') || succ;
        }
        return succ;
    }
    hp.text_fun = beforeAgsSpriteCreateTextA;
    succ = L.NewHook(hp, 'SystemAoiA') || succ;
    return succ;
}

function InsertSystemAoiHook() {
    let hModule = L.GetModuleHandle('Ags.dll');
    let wideChar = true;
    if (hModule) { // Aoi <= 3
        wideChar = false;
    } else { // Aoi >= 4
        hModule = L.GetModuleHandle('Ags5.dll');
        if (!hModule) hModule = L.GetModuleHandle('Ags4.dll');
    }
    const ok = !!hModule && InsertSystemAoiStatic(hModule, wideChar);
    if (!ok) L.hookGDIFunctions(); // InsertSystemAoiDynamic (its trigger_fun left out)
    return ok;
}

const E = L.engine({
    name: 'SystemAoi',
    check: { FILE: '*.vfs' },
    attach() { return InsertSystemAoiHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
