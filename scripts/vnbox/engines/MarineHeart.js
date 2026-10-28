// MarineHeart.js: LunaHook's MarineHeart engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/MarineHeart.cpp and MarineHeart.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

/**
 *  jichi 4/19/2014: Marine Heart
 *  妖恋愛奭�神サマ�堕し方/HS4*0@40D160 (addr 0x40d160, off 4, type 9)
 *  0040d160  /$ 55                 push ebp    ; jichi: hook here
 */
const last = []; // static lru_cache<std::string> last(5)
function lastTouch(s) {
    const i = last.indexOf(s);
    if (i >= 0) { last.splice(i, 1); last.unshift(s); return true; }
    last.unshift(s);
    if (last.length > 5) last.pop();
    return false;
}

function InsertMarineHeartHook() {
    const bytes = [
        0x51,                         // 0040d1c6  |> 51                 push ecx                        ; /facename
        0x6a, 0x01,                   // 0040d1c7  |. 6a 01              push 0x1                        ; |pitchandfamily = fixed_pitch|ff_dontcare
        0x6a, 0x03,                   // 0040d1c9  |. 6a 03              push 0x3                        ; |quality = 3.
        0x6a, 0x00,                   // 0040d1cb  |. 6a 00              push 0x0                        ; |clipprecision = clip_default_precis
        0x6a, 0x00,                   // 0040d1cd  |. 6a 00              push 0x0                        ; |outputprecision = out_default_precis
        0x68, 0x80, 0x00, 0x00, 0x00, // 0040d1cf  |. 68 80000000        push 0x80                       ; |charset = 128.
        0x6a, 0x00,                   // 0040d1d4  |. 6a 00              push 0x0                        ; |strikeout = false
        0x6a, 0x00,                   // 0040d1d6  |. 6a 00              push 0x0                        ; |underline = false
        0x6a, 0x00,                   // 0040d1d8  |. 6a 00              push 0x0                        ; |italic = false
        0x68, 0x90, 0x01, 0x00, 0x00, // 0040d1da  |. 68 90010000        push 0x190                      ; |weight = fw_normal
        0x6a, 0x00,                   // 0040d1df  |. 6a 00              push 0x0                        ; |orientation = 0x0
        0x6a, 0x00,                   // 0040d1e1  |. 6a 00              push 0x0                        ; |escapement = 0x0
        0x6a, 0x00,                   // 0040d1e3  |. 6a 00              push 0x0                        ; |width = 0x0
        0x8b, 0x46, 0x04,             // 0040d1e5  |. 8b46 04            mov eax,dword ptr ds:[esi+0x4]  ; |
        0x50,                         // 0040d1e8  |. 50                 push eax                        ; |height
        0xe8                          // 0040d1e9  |. e8 00fa0600        call <jmp.&gdi32.CreateFontA>   ; \createfonta
    ];
    const addr_offset = 0x0040d160 - 0x0040d1c6; // distance to the beginning of the function
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;

    addr += addr_offset;
    const push_ebp = 0x55; // 011d4c80  /$ 55             push ebp
    if (L.u8(addr) !== push_ebp) return false;

    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        type: L.USING_STRING | L.DATA_INDIRECT, // = 9
        filter_fun(buffer) {
            let s = buffer.strA();
            if (lastTouch(s)) return buffer.clear();
            s = L.re.sub(s, String.raw`(\x81\x40)*[\n\r]+(\x81\x40)*`);
            s = L.re.sub(s, String.raw`^(\x81\x40)*`);
            buffer.fromA(s);
        },
    }, 'MarineHeart');
}

const E = L.engine({
    name: 'MarineHeart',
    check: () => L.processName.includes('SAISYS') || L.CheckFile('SaiSys.exe'),
    files: ['SaiSys.exe'],
    attach() { return InsertMarineHeartHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
