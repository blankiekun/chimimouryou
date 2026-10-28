// Reallive.js: LunaHook's Reallive engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Reallive.cpp and Reallive.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

/* Reallive hook: process name is reallive.exe or reallive*.exe. Usually the engine has a font caching
 * issue, so LunaHook waits for the first call to GetGlyphOutlineA (InsertRealliveDynamicHook, a
 * trigger_fun) and then hooks the function that calls it (stackoffset(5), CODEC_ANSI_BE | USING_SPLIT,
 * split = esp). trigger_fun is not supported by VNBox, so that hook is left out; the GDI hooks stay.
 */
function InsertRealliveHook() {
    L.hookGDIFunctions(L.FindFunction('GetGlyphOutlineA'));
    // trigger_fun = InsertRealliveDynamicHook left out (see above)
}

function RlBabelFilter(buffer) {
    if (buffer.strA()[0] === '\x01') {
        L.StringFilterBetweenA(buffer, '\x01', '\x02'); // remove names
    }

    L.CharReplacerA(buffer, '\x08', '"');
    L.CharReplacerA(buffer, '\x09', '\'');
    L.CharReplacerA(buffer, '\x0A', '\'');
    L.CharFilterA(buffer, '\x1F'); // remove color
    L.StringReplacerA(buffer, '\x89\x85', '\x81\x63'); // "\x89\x85"-> shift-JIS"…"
    L.StringReplacerA(buffer, '\x89\x97', '--');
}

function InsertRlBabelHook() {
    /*
     * Sample games:
     * https://vndb.org/r78318
     */
    const bytes = [
        0xCC, // int 3
        0x55, // push ebp        <- hook here
        0x8B, 0xEC, // mov ebp,esp
        0x83, 0xEC, 0x20, // sub esp,20
        0xC7, 0x45, 0xFC, ...XX4, // mov [ebp-04],rlBabel.DLL+16804
    ];
    const module = L.GetModuleHandleW('rlBabel.dll');
    if (!module) return false;
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + 1, offset: L.regoffset('eax'), type: L.USING_STRING, filter_fun: RlBabelFilter }, 'RealLive Babel');
}

function clannad_en_steam() {
    // if ( v12 == 33116 || v12 == 33951 || v12 == 33962 )
    const sig = [
        0x81, 0xFE, 0x5C, 0x81, 0x00, 0x00,
        0x74, 0x10,
        0x81, 0xFE, 0x9F, 0x84, 0x00, 0x00,
        0x74, 0x08,
        0x81, 0xFE, 0xAA, 0x84, 0x00, 0x00,
        0x75, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('esi'), type: L.USING_CHAR | L.CODEC_ANSI_LE }, 'RealLiveX');
}

// veryold() (https://vndb.org/r1944) left out: it hooks GetGlyphOutline with HOOK_RETURN (no onLeave in VNBox)
// only to find, from its first call, the function that calls it (stackoffset(5), USING_CHAR | CODEC_ANSI_BE).
function veryold() {
    return false;
}

function realliveAttach() {
    InsertRealliveHook();
    InsertRlBabelHook() || clannad_en_steam() || veryold();
    return true;
}

const E = L.engine({
    name: 'Reallive',
    check: () => L.processName_lower.includes('reallive') || L.CheckFileAny(['Reallive.exe', 'REALLIVEDATA\\Start.ini']) ||
        (L.SearchResourceString('RealLive Engine') && L.SearchResourceString('VisualArt\'s RealLiveSystem')),
    files: ['Reallive.exe', 'REALLIVEDATA\\Start.ini'],
    attach: realliveAttach,
});

const Eold = L.engine({
    name: 'Reallive_old',
    // DEVOTE2 いけない放課後
    // sys\*, PDT\*, Gameexe.ini are not unique to it (other siglus games have them too)
    check: { FILE_ALL: ['G00\\*.g00', 'bgm\\*.nwa', 'koe\\*', 'wav\\*', 'sys\\*', 'PDT\\*', 'Gameexe.ini'] },
    attach: realliveAttach,
});

function avg3216dattach_function() {
    const pattern1 = [
        0x3c, 0x81, ...XX2,
        0x3c, 0x9f, ...XX2,
        0x3c, 0xe0, ...XX2,
        0x3c, 0xfc, ...XX2];
    const pattern2 = [
        0x8b, 0x75, 0x08,
        0x8a, 0x06,
        0x3c, 0x81,
        0x75, XX,
        0x80, 0x7e, 0x01, 0x7a];
    let addr = L.findBytes(pattern2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    const check = L.findBytes(pattern1, addr, addr + 0x200);
    if (!check) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.NO_CONTEXT | L.DATA_INDIRECT }, 'avg3216d');
}

function avg3216dattach_function2() {
    // https://vndb.org/v12860
    // effect～悪魔の仔～
    const pattern2 = [
        0x80, 0xf9, 0x81,
        0x72, 0x05,
        0x80, 0xf9, 0x9f,
        0x76, XX, // 76 17
        0x80, 0xf9, 0xe0,
        0x72, 0x05,
        0x80, 0xf9, 0xfc,
        0x76, 0x0d];
    let addr = L.findBytes(pattern2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x200, true);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING,
        filter_fun(buffer) {
            // いいなり
            // https://vndb.org/r17019
            if (buffer.viewA().startsWith('\x81\x7a')) {
                buffer.fromA(buffer.viewA().substr(2));
            }
        },
    }, 'avg3217d');
}

function avg3216dattach_function3() {
    // https://vndb.org/v8826
    // サークルメイト
    const pattern2 = [
        0X8A, 0X0B,
        0X80, 0XF9, 0X81,
        0X72, 0X05,
        0X80, 0XF9, 0X9F,
        0X76, 0X0A,
        0X80, 0XF9, 0XE0,
        0X72, XX,
        0X80, 0XF9, 0XFC,
        0X77, XX];
    let addr = L.findBytes(pattern2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findfuncstart(addr, 0x100, true);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(6), type: L.USING_CHAR | L.DATA_INDIRECT }, 'avg3217d');
}

const Eavg = L.engine({
    name: 'avg3216d',
    //[980731][13cm] 好き好き大好き!
    // サークルメイト https://vndb.org/r131091
    check: () => L.CheckFileAll(['koe\\*.koe', 'PDT\\*.pdt', 'Gameexe.ini']) || L.SearchStringFileInfo('AVG32/16M/TYPE_D'),
    attach() {
        if (avg3216dattach_function()) return true;
        const b3 = avg3216dattach_function3(); // `|` in C++: both run
        const b2 = avg3216dattach_function2();
        return b3 || b2;
    },
});

const EX = L.engine({
    name: 'RealliveX',
    // 部分远古版本
    check: { RESOURCE_STR: 'RealLive' },
    attach: realliveAttach,
});

module.exports = [E, Eold, Eavg, EX];
if (!module.parent) { L.run(E); L.run(Eold); L.run(Eavg); L.run(EX); }
