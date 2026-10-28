// Pal.js: LunaHook's Pal engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Pal.cpp and Pal.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX4 } = L;
const MAX_REL_ADDR = 0x00300000;

/** jichi 6/1/2014 AMUSE CRAFT (sample game: 魔女こいにっき, H-code /HBN-4*0:18@26159:MAJOKOI_try.exe)
 *  The function at hook reladdr 0x26150 processes text encoding; the hook sits on its `cmp ecx,0x81`.
 */
function InsertOldPalHook() { // this is used in case the new pattern does not work
    const bytes = [
        0x55, // push ebp ; function starts
        0x8b, 0xec, // mov ebp,esp
        0x8b, 0x45, 0x08, // mov eax,dword ptr ss:[ebp+0x8]
        0x0f, 0xb6, 0x08, // movzx ecx,byte ptr ds:[eax]
        0x81, 0xf9, // cmp ecx,0x81 ; hook here
    ];
    const addr_offset = bytes.length - 2;
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        type: L.NO_CONTEXT | L.USING_SPLIT | L.DATA_INDIRECT,
        offset: L.regoffset('eax'),
    }, 'Pal');
}

// returns the text address and size without the leading '<c .. >' and the trailing '</c>'
function trim(text, size) {
    let length = size;
    if (L.u8(text) === 0x3c && L.u8(text + 1) === 0x63) { // '<' 'c'
        const i = L.readA(text + 2).indexOf('>');
        if (i < 0) return { text, size: length };
        const p = text + 2 + i + 1;
        length -= p - text;
        text = p; // skip leading '<c .. >'
    }
    if (L.u8(text + length - 1) === 0x3e && L.u8(text + length - 2) === 0x63 && L.u8(text + length - 3) === 0x2f && L.u8(text + length - 4) === 0x3c)
        length -= 4; // skip the trailing </c>'
    return { text, size: length };
}

// the embed `after` function and the Engine::ScenarioRole/NameRole choice (retaddr - 8 is 0x088b) are left out (translation embedding)
function before(s, hp, buffer, role) {
    const text = s.stack[2]; // text in arg2
    if (!text || !L.u8(text)) return;
    const size = L.strlen(text);
    const t = trim(text, size);
    if (t.size <= 0 || !t.text || !L.u8(t.text)) return;
    buffer.from(t.text, t.size);
}

function rubyRemove(text) {
    text = L.re.sub(text, '<r(.*?)>(.*?)</r>', '$2');
    text = L.re.sub(text, '<c(.*?)>(.*?)</c>', '$2');
    text = L.re.sub(text, '<s(.*?)>(.*?)</s>', '$2');
    return text;
}

function InsertNewPal1Hook() {
    // 有乱码，无法处理。并且遇到某些中文字符会闪退
    const bytes = [
        0x55, // push ebp
        0x8b, 0xec, // mov ebp,esp
        0x83, 0xec, 0x78, // sub esp,0x78
        0xa1, ...XX4, // mov eax,dword ptr ds:[0x2f008c]
        0x33, 0xc5, // xor eax,ebp
        0x89, 0x45, 0xf8, // mov dword ptr ss:[ebp-0x8],eax ; mireado : small update
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2), // arg2
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun: before,
        filter_fun(buffer) { buffer.fromA(rubyRemove(buffer.strA())); },
    }, 'Pal');
}

// Eguni 2016/11/06
// Supporting new Pal engine, tested with 恋×シンアイ彼女
function InsertNewPal2Hook() {
    const bytes = [
        0x55, // push ebp; doesn't works... why?
        0x8b, 0xec, // mov ebp,esp
        0x83, 0xec, 0x7c, // sub esp,0x7C
        0xa1, ...XX4, // mov eax,dword ptr ds:[0x2f008c]
        0x33, 0xc5, // xor eax,ebp
        0x89, 0x45, 0xfc, // mov dword ptr ss:[ebp-0x8],eax ; mireado : small update
        0xe8, // call 01377800
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.USING_STRING }, 'Pal');
}

function redcheris() {
    const bytes = [
        // int __usercall sub_44E1E0@<eax>(char *a1@<edx>,
        // if ( *(_DWORD *)a1 == 1047683644 )
        0x8B, 0x06,
        0x3D, 0x3C, 0x62, 0x72, 0x3E,
        0x75, 0x10];
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // [230929] [ユニゾンシフト] 恋とHしかしていない！
    return L.NewHook({
        address: addr,
        offset: L.regoffset('edx'),
        type: L.USING_STRING,
        lineSeparator: '<br>',
        filter_fun(buffer) { buffer.fromA(rubyRemove(buffer.strA())); },
    }, 'Pal');
}

function InsertPalHook() { // use Old Pal first, which does not have ruby
    let succ = false;
    for (const func of ['PalSpriteCreateTextEx', 'PalSpriteCreateText', 'PalFontDrawText']) {
        succ = L.NewHook({
            type: L.USING_STRING | L.MODULE_OFFSET | L.FUNCTION_OFFSET,
            module: 'Pal.dll',
            function: func,
            offset: L.stackoffset(2),
        }, func) || succ;
    }
    const embed = InsertNewPal1Hook();
    const b1 = InsertOldPalHook() || InsertNewPal2Hook();
    const b2 = redcheris();
    return b1 || b2 || embed || succ;
}

const E = L.engine({
    name: 'Pal',
    check: () => L.CheckFile('dll\\Pal.dll') || L.GetModuleHandleW('Pal.dll'),
    files: ['dll\\Pal.dll'],
    attach() { return InsertPalHook(); },
});

module.exports = E;
if (!module.parent) L.run(E);
