// Nitroplus.js: LunaHook's Nitroplus engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nitroplus.cpp and Nitroplus.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the first hook of dmmdrc (hp.type = DIRECT_READ, read codes are not supported).
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

function InsertNitroplusHook__mbsinc() {
    //[ADV] [ニトロプラス] スマガスペシャル 初回版
    // 会一次性吐好几句出来。
    const bytes = [
        0x8b, 0x0b,
        0x51,
        0xe8, ...XX4,
        0x83, 0xc4, 0x04,
        0x89, 0x03,
        0x80, 0x38, 0x00,
        0x75, XX,
        0x80, 0xbc, ...XX2, ...XX4,
        0x74, XX,
        0x8b, 0x44, 0x24, XX,
        0x33, 0xf6,
        0x3b, 0xc6,
        0x74, XX,
        0x68, 0x00, 0x02, 0x00, 0x00,
        0x8d, 0x94, 0x24, ...XX4,
        0x56,
        0x52,
        0x89, 0x03,
        0xe8, ...XX4, // memset
    ];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 2,
        type: L.USING_CHAR | L.DATA_INDIRECT | L.NO_CONTEXT,
        offset: L.regoffset('ecx'),
    }, 'Nitroplus');
}

function InsertNitroplusHook() {
    // 多行只有第一行。
    const bytes = [0xb0, 0x74, 0x53];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sub_esp = 0xec83; // caller pattern: sub esp = 0x83,0xec
    const b = L.u8(addr + 3) & 3;
    while (L.u16(addr) !== sub_esp) addr--;
    const succ = L.NewHook({ address: addr, offset: -0x14 + (b << 2), type: L.CODEC_ANSI_BE }, 'Nitroplus');
    if (succ) InsertNitroplusHook__mbsinc();
    return succ;
}

function InsertNitroplus2Hook() {
    /*
     * Sample games:
     * https://vndb.org/v428
     */
    const bytes = [
        0x8D, 0xB4, 0x29, ...XX4, // lea esi,[ecx+ebp+0000415C]
        0x74, 0x20,               // je Django.exe+6126E
        0x8D, 0xBC, 0xBD, ...XX4, // lea edi,[ebp+edi*4+0006410C]
        0x8B, 0x56, 0xB0,         // mov edx,[esi-50]
        0xE8, ...XX4,             // call Django.exe+51150      << hook here
    ];
    const addr_offset = bytes.length - 5;
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr + addr_offset, offset: L.regoffset('edx'), type: L.CODEC_ANSI_BE }, 'Nitroplus2');
}

//	DRAMAtical Murder re:connect 普及版
// https://vndb.org/v10895
function dmmdrc() {
    // 0xc7,0x04,0x24,0x24,0x53,0x59,0x53 ($SYS), TEM_, last, _tex: an older signature, kept in a comment in the C++
    const sig = [
        0x8d, 0x89, ...XX4,
        0x8b, 0xc2,
        0xc1, 0xe8, 0x08,
        0x88, 0x01,
        0x88, 0x51, 0x01,
        0xc6, 0x41, 0x02, 0x00];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    // hp.address = *(DWORD *)(addr + 2); hp.type = DIRECT_READ; NewHook(hp, "dmmdrc"): not ported
    let succ = false;
    const sig2 = [
        0x68, 0x00, 0x02, 0x00, 0x00,
        0xba, ...XX4,
        0xe8, ...XX4];
    const buf = L.le32(L.u32(addr + 2));
    for (let i = 0; i < 4; i++) sig2[6 + i] = buf[i];
    addr = L.findBytes(sig2, addr, addr + 0x100);
    if (addr) {
        succ = L.NewHook({
            address: addr + sig2.length,
            type: L.USING_STRING,
            user_value: 0,
            text_fun(context, hp, buffer) {
                let data = context.edx;
                const l = L.strlen(data);
                if (hp.user_value > l) hp.user_value = 0;
                data += hp.user_value;
                const len = l - hp.user_value;
                hp.user_value = l;
                buffer.from(data, len);
            },
        }, 'dmmdrc2') || succ;
    }
    return succ;
}

// https://vndb.org/v7738
// 君と彼女と彼女の恋。 (the decompiled sub_477820 is in a comment in the C++)
const BYTE1 = (x) => (x >>> 8) & 0xff;
const BYTE2 = (x) => (x >>> 16) & 0xff;
const cstr = (...codes) => String.fromCharCode(...codes).split('\0')[0]; // a char[] read as a C string
function totono() {
    const sig = [
        0X81, 0XF9, 0X21, 0X00, 0X21, 0X00,
        0X74, XX,
        0X81, 0XF9, 0X3F, 0X00, 0X21, 0X00,
        0X74, XX,
        0X81, 0XF9, 0X21, 0X00, 0X3F, 0X00,
        0X74, XX,
        0X81, 0XF9, 0X3F, 0X00, 0X3F, 0X00,
        0X74, XX];
    const sig2 = [
        0XC7, 0X44, 0X24, 0X04, 0X24, 0X53, 0X59, 0X53,
        0XC7, 0X44, 0X24, 0X08, 0X54, 0X45, 0X4D, 0X5F,
        0XC7, 0X44, 0X24, 0X0C, 0X6C, 0X61, 0X73, 0X74,
        0XC7, 0X44, 0X24, 0X10, 0X5F, 0X74, 0X65, 0X78];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr) addr = L.findBytes(sig2, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x100);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun(context, hp, buffer) {
            const a1 = context.ecx;
            if (!a1) return;
            if ((a1 & 0xFF00) !== 0) {
                buffer.fromA(cstr(BYTE1(a1), a1 & 0xff));
            } else if (a1 === 2162721 || a1 === 2162751 || a1 === 4128801 || a1 === 4128831) {
                buffer.fromA(cstr(BYTE2(a1), a1 & 0xff));
            } else {
                buffer.fromA(cstr(a1 & 0xff));
            }
        },
    }, 'Nitroplus3');
}

function NitroplusSysFilter(buffer) {
    if (buffer.size <= 2) return buffer.clear();
    L.StringFilterA(buffer, '\x81@');
    L.CharReplacerA(buffer, '\r', ' ');
    if (buffer.strA().includes('<')) { // cpp_strnstr(text, "<", buffer->size)
        L.StringFilterBetweenA(buffer, '<', '>');
    }
    let s = buffer.strA();
    let n = 0;
    while (s.length - n > 1 && /[ \t-\r]/.test(s[n])) n++; // ::isspace
    if (n) buffer.fromA(s.substr(n));
}

function InsertNitroplusSysHook() {
    /*
     * Sample games:
     * https://vndb.org/r76679
     */
    const bytes = [
        0x0F, 0x84, ...XX4,     // je system.dll+5B8CA        <- hook here
        0xEB, 0x04,             // jmp system.dll+5A791
        0x8B, 0x44, 0x24, 0x20, // mov eax,[esp+20]
        0x8B, 0x4C, 0x24, 0x24, // mov ecx,[esp+24]
    ];
    const module = L.GetModuleHandleW('system.dll');
    const [minAddress, maxAddress] = L.QueryModuleLimits(module);
    const addr = L.findBytes(bytes, minAddress, maxAddress);
    if (!addr) return false;
    return L.NewHook({ address: addr, offset: L.regoffset('eax'), type: L.USING_STRING, filter_fun: NitroplusSysFilter }, 'NitroplusSystem');
}

const E = L.engine({
    name: 'Nitroplus',
    check: { FILE: '*.npa' },
    attach() { return InsertNitroplusHook() || InsertNitroplus2Hook() || dmmdrc() || totono(); },
});

const E2 = L.engine({
    name: 'Nitroplusplus',
    check: () => L.SearchResourceString('Nitro+') && L.CheckFile('system.dll'),
    certain: false,
    attach() { return InsertNitroplusSysHook(); },
});

module.exports = [E, E2];
if (!module.parent) L.run(E);
