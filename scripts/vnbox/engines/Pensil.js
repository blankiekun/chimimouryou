// Pensil.js: LunaHook's Pensil engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Pensil.cpp and Pensil.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;
const MAX_REL_ADDR = 0x00300000;

function InsertPensilHook() {
    // for (i = processStartAddress; i < processStopAddress - 4; i++) if (*(DWORD *)i == 0x6381) // cmp *,8163
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress - 4);
    for (let k = 0; k + 3 < b.length; k++) {
        if (b[k] === 0x81 && b[k + 1] === 0x63 && b[k + 2] === 0x00 && b[k + 3] === 0x00) {
            const j = L.findEnclosingAlignedFunction(base + k, 0x100);
            if (j) {
                // Artikash 7/20/2019: the VirtualProtect for a copy-on-write .text section is left out (no memory writes)
                return L.NewHook({
                    address: j,
                    offset: L.stackoffset(2),
                    split: L.stackoffset(1),
                    type: L.USING_SPLIT,
                }, 'Pensil');
            }
        }
    }
    return false;
}

function pensilfilter(buffer) {
    // 「馬鹿な、\{軌道護符|サテラ}が封じられるとは！　ハーリーの仕業か。連中の魔法科学はそこまで進んだのか！？」
    buffer.fromA(L.re.sub(buffer.strA(), String.raw`\\\{(.*?)\|(.*?)\}`, '$1'));
}

/**
 *  ScenarioHook, sample game: はにつま. Text in arg2 of the function that draws a line (it is called
 *  with GetGlyphOutlineA; the long disassembly in the C++ comment is left out). Name/scenario/other
 *  texts could be translated, history could not.
 *  Sample game: 母子愛2 (2RM)
 */
function ScenarioHookAttach(startAddress, stopAddress) {
    const bytes = [
        0x75, 0x09, // 00471236   75 09            jnz short oyakoai2.00471241
        0x5d, // 00471238   5d               pop ebp
        0x5f, // 00471239   5f               pop edi
        0x33, 0xc0, // 0047123a   33c0             xor eax,eax
        0x5e, // 0047123c   5e               pop esi
        0x83, 0xc4, 0x10, // 0047123d   83c4 10          add esp,0x10
        0xc3, // 00471240   c3               retn
    ];
    const pattern = [
        // プリズム☆ま～じカル　～Prism Generations!～
        // プリズム☆ま～じカル！AFTERSTORYS迷える子羊といけにえの山
        //[141128][bootUP!] はにつま
        0x0f, ...XX2,
        0x3d, 0x5c, 0x63, 0x00, 0x00];
    const addr = L.findBytes(bytes, startAddress, stopAddress);

    // embed flags and embed_hook_font left out (translation embedding)
    const _do = (addr) => {
        addr = L.findEnclosingAlignedFunction(addr, 0x100);
        if (!addr) return false;
        return L.NewHook({
            address: addr,
            type: L.USING_STRING,
            offset: L.stackoffset(2),
            filter_fun: pensilfilter,
        }, 'EmbedPensil');
    };
    if (addr && _do(addr)) return true;
    let ok = false;
    for (const a of L.SearchMemory(pattern, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        ok = _do(a) || ok;
    }
    return ok;
}

function OtherHookAttach(startAddress, stopAddress) {
    const bytes = [
        0x83, 0x7e, 0x14, 0x00, // 004250f6   837e 14 00       cmp dword ptr ds:[esi+0x14],0x0
        0x75, 0x09, // 004250fa   75 09            jnz short oyakoai2.00425105
        0x33, 0xc0, // 004250fc   33c0             xor eax,eax
        0x5e, // 004250fe   5e               pop esi
        0x83, 0xc4, 0x28, // 004250ff   83c4 28          add esp,0x28
        0xc2, 0x08, 0x00, // 00425102   c2 0800          retn 0x8
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, type: L.USING_STRING, offset: L.stackoffset(1), filter_fun: pensilfilter }, 'EmbedPensilChoice');
}

/** jichi 8/2/2014 2RM
 *  - [エロイッ] 父娘愛2 /HBN-20*0@54925:oyakoai.exe
 *  - The executable shows product name as 2RM - Adventure Engine; the LAST place accessing the text is hooked
 */
function Insert2RMHook() {
    const bytes = [
        0x80, 0x3f, 0x00, // 0045428d   803f 00          cmp byte ptr ds:[edi],0x0
        0x0f, 0x84, 0xdb, 0x00, 0x00, 0x00, // 00454290   0f84 db000000    je .00454371
        0x0f, 0xb7, 0x17, // 00454296   0fb717           movzx edx,word ptr ds:[edi] ; jichi: hook here
        0x8b, 0x4c, 0x24, 0x10, // 00454299   8b4c24 10        mov ecx,dword ptr ss:[esp+0x10]
        0x52, // 0045429d   52               push edx
        0x89, 0x4c, 0x24, 0x2c, // 0045429e   894c24 2c        mov dword ptr ss:[esp+0x2c],ecx
        0xe8, // 004542a2   e8 498a0100      call .0046ccf0
    ];
    const addr_offset = 0x00454296 - 0x0045428d;
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('edi'), type: L.NO_CONTEXT | L.DATA_INDIRECT }, '2RM');
}

function abalone() {
    // 鬼孕の学園～スク水少女異種姦凌辱劇～
    const bs = [
        0xD8, 0x0D, ...XX4,
        0xd9, 0x50, XX,
        0xd9, 0x58, XX,
        0xdb, 0x44, 0x24, XX,
        0xD8, 0x0D, ...XX4,
        0xd9, 0x50, XX,
        0xd9, 0x58, XX,
        0xdb, 0x44, 0x24, XX,
        0xD8, 0x0D, ...XX4,
        0xd9, 0x50, XX,
        0xd9, 0x58, XX];
    let addr = L.findBytes(bs, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(3), split: L.stackoffset(4), type: L.USING_SPLIT }, 'abalone');
}

const E = L.engine({
    name: 'Pensil',
    certain: false,
    // jichi 2/28/2015: Delay checking Pensil in case something went wrong
    // File pattern observed in [Primula] 大正×対称アリス episode I
    // - MovieTexture.dll information shows MovieTex dynamic library, copyright Pensil 2013
    // - ta_trial.exe information shows 2XT - Primula Adventure Engine
    check: () => (L.CheckFileAny(['PSetup.exe', 'PENCIL.*']) || L.SearchResourceString('2XT -')) ||
        L.CheckFile('MovieTexture.dll') ||
        (L.SearchResourceString('2RM') && L.SearchResourceString('Adventure Engine')) ||
        L.CheckFileAll(['archive.dat', 'bgm.dat', 'se.dat', 'voice.dat', 'save\\syssave.dat']), // 鬼孕の学園　スク水少女異種姦凌辱劇
    files: ['PSetup.exe', 'PENCIL.*', 'MovieTexture.dll'],
    attach() {
        const _1 = ScenarioHookAttach(L.processStartAddress, L.processStopAddress);
        if (_1) OtherHookAttach(L.processStartAddress, L.processStopAddress);
        const _2rm = Insert2RMHook();
        const _abalone = abalone();
        return InsertPensilHook() || _1 || _2rm || _abalone;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
