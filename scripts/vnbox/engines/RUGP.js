// RUGP.js: LunaHook's RUGP engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/RUGP.cpp and RUGP.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

// SearchPattern(base, length, bytes) of ithsys.cc: the offset of the first match from base, 0 when none.
function SearchPattern(base, length, bytes) {
    const hi = Math.min(base + length - 1, 0xffffffff);
    const a = L.findBytes(bytes, base, hi);
    return a ? a - base : 0;
}

/********************************************************************************************
rUGP hook:
  Process name is rugp.exe. Used by AGE/GIGA games.
  Font caching issue. Find call to GetGlyphOutlineA and keep stepping out functions.
  After several tries we comes to address in rvmm.dll and everything is catched.
  We see CALL [E*X+0x*] while EBP contains the character data.
  It's not as simple to reverse in rugp at run time as like reallive since rugp dosen't set
  up stack frame. In other words EBP is used for other purpose. We need to find alternative
  approaches.
  The way to the entry of that function gives us clue to find it. There is one CMP EBP,0x8140
  instruction in this function and that's enough! 0x8140 is the start of SHIFT-JIS
  characters. It's determining if ebp contains a SHIFT-JIS character. This function is not likely
  to be used in other ways. We simply search for this instruction and place hook around.
********************************************************************************************/
function SpecialHookRUGP1(context, hp, buffer) {
    let stack = context.base;
    let i, val = 0;
    for (i = 0; i < 4; i++) {
        val = L.u32(stack);
        stack += 4;
        if ((val >>> 16) === 0) break;
    }
    if (i < 4) {
        hp.offset = i << 2;
        if (i === 2 && hp.user_value !== 1) {
            hp.split = L.stackoffset(1);
            hp.type |= L.USING_SPLIT;
        }
        buffer.from_t(val & 0xffff, 2);
        hp.text_fun = null;
    }
}

function InsertRUGP1Hook() {
    if (!L.CheckFile('rvmm.dll')) return false;
    const ch = L.le32(0x8140);
    const range = 0x20000;
    const low = L.GetModuleHandleW('rvmm.dll');
    let t = SearchPattern(low + range, L.processStopAddress, ch) + range;
    let s = low + t;
    if (t !== range) { // jichi 10/1/2013: Changed to compare with 0x20000
        if (L.u8(s - 2) !== 0x81) return false;
        const i = L.findEnclosingAlignedFunction(s, 0x200);
        if (i) {
            const [ms, me] = L.QueryModuleLimits(low);
            const refs = L.findxref_reverse_checkcallop(i, ms, me, 0xe8);
            if (refs.length === 1) {
                const f2 = L.findfuncstart(refs[0], 0x100, true);
                if (f2) {
                    return L.NewHook({
                        address: f2,
                        text_fun: SpecialHookRUGP1,
                        user_value: 1,
                        type: L.CODEC_ANSI_BE | L.USING_CHAR,
                    }, 'rUGP');
                }
            }
            const check = [
                // 螺旋回廊 2000版
                0x75, XX,
                0x8b, 0x86];
            if (L.MatchPattern(i, check)) return false;
            return L.NewHook({ address: i, text_fun: SpecialHookRUGP1, type: L.CODEC_ANSI_BE | L.USING_CHAR }, 'rUGP');
        }
    } else {
        t = SearchPattern(low, range, L.le32(s)); // searches for the bytes of the pointer s itself
        if (!t) return false;
        s = low + t;
        for (let i = 0; i < 0x200; i++, s--) {
            if (L.u8(s) === 0x90 && L.u32(s - 3) === 0x90909090) {
                t = low + t - i + 1;
                return L.NewHook({ address: t, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'rUGP');
            }
        }
    }
    return false;
}

/** rUGP2 10/11/2014 jichi
 *
 *  Sample game: マブラヴ オルタネイヂ�ヴ ト�タル・イクリプス
 *  The existing rUGP#1/#2 cannot be identified.
 *  H-codes: /HAN-4@1E51D:VM60.DLL (length_offset 1, off -8, type 0x444)
 *  This function is very long; jichi hooks at 1001e51d (mov ecx,0x1).
 */
function InsertRUGP2Hook() {
    const module = L.GetModuleHandleW('vm60.dll');
    if (!module) return false;
    const bytes = [
        0x0f, 0xb6, 0x0e,             // 1001e515   0fb60e           movzx ecx,byte ptr ds:[esi]
        0xc1, 0xe0, 0x08,             // 1001e518   c1e0 08          shl eax,0x8
        0x0b, 0xc1,                   // 1001e51b   0bc1             or eax,ecx
        0xb9, 0x01, 0x00, 0x00, 0x00, // 1001e51d   b9 01000000      mov ecx,0x1     ; jichi: hook here
        0x03, 0xf1,                   // 1001e522   03f1             add esi,ecx
        0x89, 0x45, 0x08,             // 1001e524   8945 08          mov dword ptr ss:[ebp+0x8],eax
        0x89, 0x75, 0x0c,             // 1001e527   8975 0c          mov dword ptr ss:[ebp+0xc],esi
    ];
    const addr_offset = 0x1001e51d - 0x1001e515;
    const addr = L.findBytes(bytes, module, L.QueryModuleLimits(module)[1]);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('eax'), type: L.NO_CONTEXT | L.CODEC_ANSI_BE }, 'rUGP2');
}

// マブラヴ オルタネイティヴ クロニクルズ04
function h3() {
    const low = L.GetModuleHandleW('rvmm.dll');
    if (!low) return false;
    const [s, e] = L.QueryModuleLimits(low);
    const caller = L.findiatcallormov(L.FindFunction('GetGlyphOutlineA'), low, s, e);
    if (!caller) return false;
    const func = L.findfuncstart(caller, 0x200, true);
    if (!func) return false;
    // a2 == 33088
    const sig = [0x81, XX, 0x40, 0x81, 0x00, 0x00];
    if (!L.findBytes(sig, func, caller)) return false;
    const refs = L.findxref_reverse_checkcallop(func, s, e, 0xe8);
    if (refs.length === 1) {
        const f2 = L.findfuncstart(refs[0], 0x100, true);
        if (f2) return L.NewHook({ address: f2, offset: L.stackoffset(2), type: L.CODEC_ANSI_BE }, 'rUGP3');
    }
    return L.NewHook({
        address: func,
        offset: L.stackoffset(2),
        split: L.stackoffset(1),
        type: L.NO_CONTEXT | L.CODEC_ANSI_BE | L.USING_SPLIT,
    }, 'rUGP3');
}

function GetCachedFont() {
    // 螺旋回廊 2000版
    const UnivUI = L.GetModuleHandleW('UnivUI.dll');
    if (!UnivUI) return false;
    const fn = L.GetProcAddress(UnivUI, '?GetCachedFont@CFontAttr@@QAEPAUCS5RFontEntry@@I@Z');
    if (!fn) return false;
    return L.NewHook({ address: fn, offset: L.stackoffset(1), type: L.CODEC_ANSI_BE }, 'UnivUI::GetCachedFont');
}

function InsertRUGPHook() {
    return InsertRUGP1Hook() || InsertRUGP2Hook() || GetCachedFont();
}

const E = L.engine({
    name: 'RUGP',
    check: () => L.processName_lower.includes('rugp') || L.CheckFile('rugp.exe'),
    files: ['rugp.exe'],
    attach() { return InsertRUGPHook() || h3(); },
});

module.exports = E;
if (!module.parent) L.run(E);
