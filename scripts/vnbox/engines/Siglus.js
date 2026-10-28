// Siglus.js: LunaHook's Siglus engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Siglus.cpp and Siglus.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

const MAX_REL_ADDR = 0x00300000;

// TextUnionW (pack 4): union { wchar_t *text; wchar_t chars[8]; } at 0, size at 0x10, capacity at 0x14.
// (setText, used only to write the translation back, is left out)
const textUnionW = (p) => {
    const size = L.u32(p + 0x10), capacity = L.u32(p + 0x14);
    const at = capacity < 8 ? p : L.u32(p);
    return {
        at, size,
        view: () => L.readW(at, size),
        isValid() {
            return size > 0 && size <= capacity && L.isAddressReadable(at, size) && L.wcslen(at) === size;
        },
    };
};

function InsertSiglus3Hook() {
    const bytes = [
        0x8b, 0x12, // 002667d3   8b12             mov edx,dword ptr ds:[edx]
        0x8b, 0x4d, 0x08, // 002667d5   8b4d 08          mov ecx,dword ptr ss:[ebp+0x8]
        0x66, 0x8b, 0x45, 0x10, // 002667d8   66:8b45 10       mov ax,word ptr ss:[ebp+0x10]
        0x66, 0x89, 0x04, 0x4a, // 002667dc   66:89044a        mov word ptr ds:[edx+ecx*2],ax ; jichi: wchar_t in ax
    ];
    const addr_offset = bytes.length - 4;
    const range = Math.max(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('eax'), type: L.CODEC_UTF16 }, 'SiglusEngine3');
}

function Siglus4Filter(buffer) {
    L.StringFilterW(buffer, 'NLI');
}

function SpecialHookSiglus4(context, hp, buffer, split) {
    const tu = textUnionW(context.eax);
    if (L.all_ascii(tu.view())) return;

    buffer.from(tu.at, tu.size * 2); // UTF-16
    const s0 = context.retaddr; // use stack[0] as split
    if (s0 <= 0xff) { // scenario text
        split.value = L.FIXED_SPLIT_VALUE;
    } else if (L.IsBadReadPtr(s0, 4)) {
        split.value = s0;
    } else {
        split.value = L.u32(s0); // This value is runtime dependent
        if (split.value === 0x54) split.value = L.FIXED_SPLIT_VALUE * 2;
    }
    split.value = (split.value + context.stack[1]) >>> 0; // plus stack[1] as split
}

function InsertSiglus4Hook() {
    const bytes = [
        0xc7, 0x47, 0x14, 0x07, 0x00, 0x00, 0x00, // 0042cf20   c747 14 07000000 mov dword ptr ds:[edi+0x14],0x7
        0xc7, 0x47, 0x10, 0x00, 0x00, 0x00, 0x00, // 0042cf27   c747 10 00000000 mov dword ptr ds:[edi+0x10],0x0
        0x66, 0x89, 0x0f, // 0042cf2e   66:890f          mov word ptr ds:[edi],cx
        0x8b, 0xcf, // 0042cf31   8bcf             mov ecx,edi
        0x50, // 0042cf33   50               push eax
        0xe8, // 0042cf34   e8 e725f6ff      call .0038f520
    ];
    const addr_offset = bytes.length + 4; // +4 for the call address
    const range = Math.max(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr + addr_offset,
        type: L.NO_CONTEXT | L.CODEC_UTF16,
        text_fun: SpecialHookSiglus4,
        filter_fun: Siglus4Filter,
    }, 'SiglusEngine4');
}

function InsertSiglus2Hook() {
    const range = Math.min(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr;
    { // type 1
        const bytes = [
            0x3b, 0xd7, // cmp edx,edi ; hook here
            0x75, 0x4b, // jnz short
        ];
        addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    }
    if (!addr) {
        const bytes = [
            0x81, 0xfe, 0x0c, 0x30, 0x00, 0x00, // 0114124a   81fe 0c300000    cmp esi,0x300c  ; jichi: hook here
        ];
        addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    }
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('esi'),
        type: L.CODEC_UTF16 | L.FIXING_SPLIT, // jichi 6/1/2014: fixing the split value
    }, 'SiglusEngine2');
}

function SpecialHookSiglus1(context, hp, buffer) {
    const textu = textUnionW(context.ecx + 4);
    buffer.fromW(textu.view());
}

function InsertSiglus1Hook() {
    const bytes = [0x33, 0xc0, 0x8b, 0xf9, 0x89, 0x7c, 0x24];
    const range = Math.max(L.processStopAddress - L.processStartAddress, MAX_REL_ADDR);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false; // jichi 8/17/2013: Add "== 0" check to prevent breaking new games
    const limit = addr - 0x100;
    while (addr > limit) {
        if (L.u16(addr) === 0xff6a) {
            return L.NewHook({ address: addr, text_fun: SpecialHookSiglus1, type: L.CODEC_UTF16 }, 'SiglusEngine');
        }
        addr--;
    }
    return false;
}

function InsertSiglusHook() {
    if (InsertSiglus1Hook()) return true;
    let ok = InsertSiglus2Hook();
    ok = InsertSiglus3Hook() || ok;
    ok = InsertSiglus4Hook() || ok;
    return ok;
}

function InsertSiglusHookZ() {
    const bytes = [
        0x8b, 0x12,
        0x66, 0x89, 0x04, 0x72];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + 2, offset: L.regoffset('eax'), type: L.CODEC_UTF16 }, 'SiglusHookZ');
}

// ---- ScenarioHook (embed parts left out: embed_fun, embed_hook_font, setText) ----
const Type1 = 1; // Old SiglusEngine2, arg in ecx
const Type2 = 2; // New SiglusENgine2, arg in arg1, since リア充クラスメイト孕ませ催眠 in 9/26/2014
let scenarioType = 0;

function scenarioSearch(startAddress, stopAddress) {
    let addr;
    {
        const bytes1 = [
            0x3b, 0xd7, // 013baf32  |. 3bd7       |cmp edx,edi ; jichi: ITH hook here, char saved in edi
            0x75, 0x4b, // 013baf34  |. 75 4b      |jnz short siglusen.013baf81
        ];
        addr = L.findBytes(bytes1, startAddress, stopAddress);
        if (addr) scenarioType = Type1;
    }
    if (!addr) {
        const bytes2 = [
            0x81, 0xfe, 0x0c, 0x30, 0x00, 0x00, // 0114124a   81fe 0c300000    cmp esi,0x300c  ; jichi: hook here
        ];
        addr = L.findBytes(bytes2, startAddress, stopAddress);
        if (addr) scenarioType = Type2;
    }
    if (!addr) return 0;
    const bytes = [
        0x55, // 013bac70  /$ 55       push ebp ; jichi: function starts
        0x8b, 0xec, // 013bac71  |. 8bec     mov ebp,esp
        0x6a, 0xff, // 013bac73  |. 6a ff    push -0x1
    ];
    const range = 0x500; // 0x00b6bcf8 - 0x00b6b880 = 0x478
    return L.findBytes(bytes, addr - range, addr);
}

function scenarioTextFun(context, hp, buffer) {
    const arg = scenarioType === Type1 ? context.ecx : context.stack[1];
    if (!arg) return;
    const tu = textUnionW(arg);
    if (!tu.isValid()) return;
    buffer.fromW(tu.view());
}

function scenarioAttach(startAddress, stopAddress) { // attach scenario
    const addr = scenarioSearch(startAddress, stopAddress);
    if (!addr) return null;
    return {
        address: addr,
        type: L.CODEC_UTF16 | L.NO_CONTEXT, // 0x41
        text_fun: scenarioTextFun,
        name: 'EmbedSiglus',
    };
}

// ---- OtherHook ----
function otherHookBefore(context, hp, buffer) {
    const arg = context.stack[0];
    if (!arg) return;
    const tu = textUnionW(arg);
    if (!tu.isValid()) return;
    const vw = tu.view();
    if (!vw || !vw.length || vw.charCodeAt(0) <= 127 || vw.length > 1500) return; // there could be garbage

    const split = context.stack[3];
    if (split <= 0xffff || !L.isAddressReadable(split)) return; // skip modifying scenario thread
    // *split's 0x54 / 0x26 only picked NameRole: no role in VNBox
    buffer.fromW(vw);
}

function otherSearch(startAddress, stopAddress) {
    const bytes = [
        0xc7, 0x47, 0x14, 0x07, 0x00, 0x00, 0x00, // 0042cf20   c747 14 07000000 mov dword ptr ds:[edi+0x14],0x7
        0xc7, 0x47, 0x10, 0x00, 0x00, 0x00, 0x00, // 0042cf27   c747 10 00000000 mov dword ptr ds:[edi+0x10],0x0
        0x66, 0x89, 0x0f, // 0042cf2e   66:890f          mov word ptr ds:[edi],cx
        0x8b, 0xcf, // 0042cf31   8bcf             mov ecx,edi
        0x50, // 0042cf33   50               push eax
        0xe8, // 0042cf34   e8 e725f6ff      call .0038f520 ; jichi: hook here
    ];
    const addr_offset = bytes.length - 1; // +4 for the call address
    const addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return 0;
    return addr + addr_offset;
}

function otherAttach(startAddress, stopAddress) {
    const addr = otherSearch(startAddress, stopAddress);
    if (!addr) return null;
    return {
        address: addr,
        type: L.CODEC_UTF16 | L.NO_CONTEXT, // 0x41
        text_fun: otherHookBefore,
        name: 'EmbedSiglus2',
    };
}

let ebpoff = 0; // static int ebpoff in h3_n

function h3_n() {
    const bytes = [
        0x8b, 0x55, XX,
        0x8b, 0x0d, ...XX4,
        0x89, 0x4d, XX,
        0x85, 0xd2,
        0x0f, 0x84, ...XX4,
        0x83, 0x7d, XX, 0x07,
        0x8d, 0x45, XX,
        0x52,
        0x0f, 0x47, 0x45, XX,
        0x83, 0xc1, 0x68,
        0x50,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const offset = addr + 3 + 6 + 3 + 2 + 6 + 4 + 2;
    ebpoff = 0x100 - L.u8(offset);
    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF16,
        text_fun(s, hp, buffer) {
            const arg = textUnionW((s.ebp - ebpoff) >>> 0);
            buffer.fromW(arg.view());
        },
    }, 'EmbedSiglus2_1');
}

function h3_t() {
    const bytes = [
        0x81, XX, XX, 0x00, 0x01, 0x00, 0x00,
        0x7e, XX,
        0x8b, 0x4e, 0x10,
        0x81, 0xf9, 0x00, 0x01, 0x00, 0x00,
        0x72, XX,
        0xc7, 0x46, 0x10, 0x00, 0x01, 0x00, 0x00,
        0x83, 0x7e, 0x14, 0x07,
        0x76, 0x02,
        0x8b, 0x36];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.CODEC_UTF16,
        text_fun(s, hp, buffer) {
            const arg = textUnionW(s.ecx);
            buffer.fromW(arg.view());
        },
    }, 'EmbedSiglus2');
}

function h3() {
    return h3_t() && h3_n();
}

const E = L.engine({
    name: 'Siglus',
    check: () => L.processName_lower.includes('siglusengine') || L.processName_lower.startsWith('siglus~') ||
        L.CheckFile('SiglusEngine.exe'),
    files: ['SiglusEngine.exe'],
    attach() {
        const hps = [];
        const b3 = scenarioAttach(L.processStartAddress, L.processStopAddress); // 这个会和其他有重叠。
        if (b3) {
            hps.push(b3);
            const other = otherAttach(L.processStartAddress, L.processStopAddress);
            if (other) hps.push(other);
        }
        const b1 = InsertSiglusHook();
        const b2 = InsertSiglusHookZ();
        let b = false;
        for (const hp of hps) {
            const name = hp.name;
            b = L.NewHook(hp, name) || b;
        }
        return b || b1 || b2 || h3();
    },
});

module.exports = E;
if (!module.parent) L.run(E);
