// EME.js: LunaHook's EME engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/EME.cpp and EME.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/********************************************************************************************
EMEHook hook: (Contributed by Freaka)
  EmonEngine is used by LoveJuice company and TakeOut. Earlier builds were apparently
  called Runrun engine. String parsing varies a lot depending on the font settings and
  speed setting. 0x09 is a line break, 0x0D a paragraph end.
********************************************************************************************/
function InsertEMEHook() {
    const addr = L.findCallAddress(L.FindFunction('IsDBCSLeadByte'), L.processStartAddress, L.processStopAddress);
    // no needed as first call to IsDBCSLeadByte is correct, but sig could be used for further verification
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.NO_CONTEXT | L.DATA_INDIRECT | L.USING_CHAR,
        filter_fun(buffer) {
            let xx = buffer.strA();
            xx = L.strReplace(xx, '\t');
            buffer.fromA(xx);
        },
    }, 'EmonEngine');
}

// takeout() (みちくさ～Loitering on the way～) is left out: it installs LunaHook's trigger_fun on
// GetGlyphOutlineA, which VNBox has no equivalent of, and it returns false anyway.
// egoto() (エゴと後悔のジレンマ) is left out: it hooks Tegoto, a function defined inside LunaHook
// (DECLARE_FUNCTION) that its filter calls to inject the text, so there is no game code to hook.

/*
v8 = (BYTE *)(*(_DWORD *)(this + 64) + v7);
if ( *v8 == 9 ) { ... return 1; } else { if ( IsDBCSLeadByte(*v8) )
*/
function emeengine() {
    const sig = [
        // mov cl, [eax]; cmp cl, 9; jnz short loc_42D08E
        0x8A, 0x08,
        0x80, 0xF9, 0x09,
        0x75, XX];
    const __IsDBCSLeadByte = L.FindImportEntry(L.processStartAddress, L.FindFunction('IsDBCSLeadByte'));
    if (!__IsDBCSLeadByte) return false;
    const tgt = [
        // push ecx ; TestChar / call ds:IsDBCSLeadByte
        0x51,
        0xFF, 0x15, ...L.le32(__IsDBCSLeadByte)];
    for (const addr of L.SearchMemory(sig, L.PAGE_EXECUTE_READWRITE, L.processStartAddress, L.processStopAddress)) {
        const off = L.u8(addr + sig.length - 1);
        const target = addr + sig.length + off;
        if (!L.MatchPattern(target, tgt)) continue;
        return L.NewHook({
            address: addr,
            offset: L.regoffset('eax'),
            type: L.NO_CONTEXT | L.DATA_INDIRECT | L.USING_CHAR,
            filter_fun(buffer) {
                let xx = buffer.strA();
                xx = L.strReplace(xx, '\t');
                buffer.fromA(xx);
            },
        }, 'EmonEngine2');
    }
    return InsertEMEHook();
}

const E = L.engine({
    name: 'EME',
    check: { FILE: 'emecfg.ecf' },
    attach() {
        return emeengine();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
