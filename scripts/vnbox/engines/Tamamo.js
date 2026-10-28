// Tamamo.js: LunaHook's Tamamo engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Tamamo.cpp and Tamamo.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const VNR_TEXT_CAPACITY = 1500;

function TamamoFilter(buffer) {
    if (buffer.strA().includes('<')) L.StringFilterA(buffer, '<e>');
    L.StringFilterA(buffer, '\x0d\x0a\x81\x40'); // remove \n before space
    L.StringFilterBetweenA(buffer, '<', '>');
    L.StringFilterBetweenA(buffer, '{', '}');
}

function SpecialHookTamamo(context, hp, buffer, split) {
    const text = context.stack[1]; // arg1
    const size = context.stack[2]; // arg2
    if (0 < size && size < VNR_TEXT_CAPACITY && size === L.strlen(text) && !L.all_ascii(L.readA(text))) {
        split.value = context.stack[5];
        buffer.from(text, size);
    }
}

function InsertTamamoHook() {
    let addr = 0;
    { // for new games
        const bytes = [
            0x8b, 0xd6, // 0051c287   8bd6             mov edx,esi
            0x85, 0xff, // 0051c289   85ff             test edi,edi
            0x74, 0x0e, // 0051c28b   74 0e            je short .0051c29b
            0x57, // 0051c28d   57               push edi
            0x8d, 0x04, 0x0b, // 0051c28e   8d040b           lea eax,dword ptr ds:[ebx+ecx]
            0x50, // 0051c291   50               push eax
            0x52, // 0051c292   52               push edx
            0xe8, // 0051c293   e8 f8440f00      call .00610790    ; jichi: copy invoked here
        ];
        addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (addr) addr += bytes.length - 1;
    }
    if (!addr) { // for old games
        const bytes = [
            0x72, 0x11, // 0067fa5b   72 11            jb short .0067fa6e
            0x56, // 0067fa5d   56               push esi
            0xff, 0x75, 0x10, // 0067fa5e   ff75 10          push dword ptr ss:[ebp+0x10]
            0xff, 0x75, 0x08, // 0067fa61   ff75 08          push dword ptr ss:[ebp+0x8]
            0xe8, // 0067fa64   e8 27080000      call .00680290  ; jichi: copy invoked here
        ];
        addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
        if (addr) addr += bytes.length - 1;
    }
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        text_fun: SpecialHookTamamo,
        filter_fun: TamamoFilter,
        type: L.USING_STRING | L.USING_SPLIT | L.NO_CONTEXT,
    }, 'Tamamo');
}

function Tamamogettext(buffer) {
    let s = buffer.strA();
    s = L.re.sub(s, '\\{#(.*?)\\}');
    s = L.re.sub(s, '<(.*?)>');
    s = L.re.sub(s, '(.*)\x81u([\\s\\S]*?)\x81v(.*)', '\x81u$2\x81v'); // 「  」
    s = L.re.sub(s, '(.*)\x81i([\\s\\S]*?)\x81j(.*)', '\x81i$2\x81j'); // （  ）
    buffer.fromA(s);
}

function Tamamogetname(buffer) {
    let s = buffer.strA();
    s = L.re.sub(s, '\\{#(.*?)\\}');
    s = L.re.sub(s, '<(.*?)>');
    if (s.includes('\x81u') && s.includes('\x81v')) s = L.re.sub(s, '(.*)\x81u([\\s\\S]*?)\x81v(.*)', '$1'); // 「  」
    else if (s.includes('\x81i') && s.includes('\x81j')) s = L.re.sub(s, '(.*)\x81i([\\s\\S]*?)\x81j(.*)', '$1'); // （  ）
    else return buffer.clear();
    buffer.fromA(s);
}

function tamamo3() {
    // 閃光の騎士 ～カリスティアナイト～
    const face = L.aToBytes('face_%s_%s.png\0');
    const faceAddr = L.findBytes(face, L.processStartAddress, L.processStopAddress);
    if (!faceAddr) return false;
    let ok = false;

    const bytes = [0x68, ...L.le32(faceAddr)];
    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        addr = L.findEnclosingAlignedFunction(addr);
        if (!addr) continue;
        ok = L.NewHook({
            address: addr,
            offset: L.stackoffset(1),
            type: L.USING_STRING,
            filter_fun: Tamamogettext,
        }, 'tamamo_text') || ok;
        ok = L.NewHook({
            address: addr + 5,
            offset: L.stackoffset(3),
            type: L.USING_STRING,
            filter_fun: Tamamogetname,
        }, 'tamamo_name') || ok;
    }
    return ok;
}

const E = L.engine({
    name: 'Tamamo',
    check: { FILE_ALL: ['data.pck', 'image.pck', 'script.pck'] },
    attach() {
        const aa = tamamo3();
        return InsertTamamoHook() || aa;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
