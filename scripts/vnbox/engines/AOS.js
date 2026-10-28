// AOS.js: LunaHook's AOS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/AOS.cpp and AOS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX } = L;

function InsertAOS1Hook() {
    // jichi 4/2/2014: The starting of this function is different from another game, so use a pattern in
    // the middle of the function instead.
    const bytes = [
        0x0f, 0xbf, 0x55, 0x1c, // movsx edx,word ptr ss:[ebp+0x1c]
        0x0f, 0xbf, 0x45, 0x0a, // movsx eax,word ptr ss:[ebp+0xa]
        0x0f, 0xbf, 0x75, 0x1a, // movsx esi,word ptr ss:[ebp+0x1a]
        0x03, 0xd7,             // add edx,edi
        0x03, 0xc2,             // add eax,edx
        0x0f, 0xbf, 0x55, 0x08, // movsx edx,word ptr ss:[ebp+0x8]
        0x03, 0xf7,             // add esi,edi
        0x03, 0xd6,             // add edx,esi
        0x85, 0xc9              // test ecx,ecx
    ];
    const addr_offset = 0x00e3c2f0 - 0x00e3c33c; // distance to the beginning of the function, which is 0x51 (push ecx)
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr = (addr + addr_offset) >>> 0;
    const push_ecx = 0x51; // beginning of the function
    if (L.u8(addr) !== push_ecx) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.DATA_INDIRECT }, 'AOS1');
}

function InsertAOS2Hook() {
    const bytes = [
        0x51,       // push ecx ; mireado: hook here, function begins
        0x33, 0xc0, // xor eax,eax
        0x53,       // push ebx
        0x55,       // push ebp
        0x8b, 0x2d  // mov ebp,dword ptr ds:[...]  (the address changes between builds)
    ];
    const addr_offset = 0; // distance to the beginning of the function, which is 0x51 (push ecx)
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    addr += addr_offset;
    const push_ecx = 0x51; // beginning of the function
    if (L.u8(addr) !== push_ecx) return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(2), type: L.DATA_INDIRECT }, 'AOS2');
}

function InsertAOSHook() {
    return InsertAOS1Hook() || InsertAOS2Hook();
}

function calladdr(addr) {
    if (!addr) return 0;
    addr = L.reverseFindBytes([0xe8], addr - 0x20, addr);
    if (!addr) return 0;
    const calladdr = L.i32(addr + 1);
    addr = (calladdr + addr + 5) >>> 0;
    if (L.u8(addr - 1) !== 0xcc) return 0;
    return addr;
}
function lastcall() {
    let addr = L.findiatcallormov(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, true);
    if (!addr) return 0;
    addr = L.findEnclosingAlignedFunction(addr);
    return addr;
}
function mov_reg_ebpoffset(reg) {
    switch (reg) {
    case 0x4B: return L.regoffset('ebx');
    case 0x48: return L.regoffset('eax');
    case 0x49: return L.regoffset('ecx');
    case 0x4a: return L.regoffset('edx');
    case 0x4c: return L.regoffset('ebp');
    case 0x4d: return L.regoffset('esp');
    case 0x4e: return L.regoffset('esi');
    case 0x4f: return L.regoffset('edi');
    default: return -1;
    }
}
function AOS_EX() {
    const aos_shared_bytes1 = [
        0x3c, XX,
        0x74, XX,
        0x3c, XX,
        0x74, XX,
        0x3c, XX,
        0x74, XX,
        0x3c, XX,
        0x74, XX,
        0x3c, XX,
        0x74, XX];
    const aos_shared_bytes2 = [
        0x80, 0xfb, XX,
        0x74, XX,
        0x80, 0xfb, XX,
        0x74, XX,
        0x80, 0xfb, XX,
        0x74, XX,
        0x80, 0xfb, XX,
        0x74, XX];
    const addrs = [];
    addrs.push(calladdr(L.findBytes(aos_shared_bytes1, L.processStartAddress, L.processStopAddress)));
    addrs.push(calladdr(L.findBytes(aos_shared_bytes2, L.processStartAddress, L.processStopAddress)));
    addrs.push(lastcall());
    for (const addr of addrs) {
        if (!addr) continue;
        const reg = mov_reg_ebpoffset(L.u8(addr + 5));
        let off;
        if (reg !== -1) {
            // usercall
            off = reg;
        } else if (L.u16(addr) === 0xec83) {
            // 姫様LOVEライフ！ also usercall, but the second argument is on the stack.
            off = L.stackoffset(1);
        } else {
            // 螺旋遡行のディストピア -The infinite set of alternative version- 官方中文
            const sig = [0x89, 0x55, 0xFC];
            if (L.findBytes(sig, addr, addr + 0x20)) {
                off = L.regoffset('edx');
            } else {
                // cdecl
                off = L.stackoffset(2);
            }
        }
        return L.NewHook({ address: addr, offset: off, type: L.NO_CONTEXT | L.DATA_INDIRECT, index: 0 }, 'AOS_EX');
    }
    return false;
}

const E = L.engine({
    name: 'AOS',
    check: { FILE: '*.aos' },
    attach() {
        const b1 = InsertAOSHook();
        const b3 = AOS_EX();
        return b1 || b3;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
