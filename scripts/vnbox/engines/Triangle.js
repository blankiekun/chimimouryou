// Triangle.js: LunaHook's Triangle engines for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Triangle.cpp and Triangle.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

// a memory read that gives 0 where the guest cannot read
const rd8 = (a) => { try { return L.u8(a); } catch (e) { return 0; } };
const rd32 = (a) => { try { return L.u32(a); } catch (e) { return 0; } };

function InsertTriangleHook() {
    const start = L.processStartAddress, stop = L.processStopAddress;
    const { bytes: b, base } = L.region(start, stop);
    const at = (a) => b[a - base] || 0;
    for (let i = start; i < stop - 4; i++) {
        let j = 0;
        if (at(i) === 0x3c && at(i + 1) === 0x40 && at(i + 2) === 0x75) { // (*(DWORD *)i & 0xffffff) == 0x75403c
            j = i + 4 + at(i + 3);
        } else if (at(i) === 0x3c && at(i + 1) === 0x40 && at(i + 2) === 0x0f && at(i + 3) === 0x85) { // *(DWORD *)i == 0x850f403c
            // 长跳转
            // エグゼクタースクリプト
            j = (i + 4 + (rd32(i + 4) | 0)) >>> 0;
        }

        if (j) {
            for (const k = j + 0x20; j < k; j++) {
                if (rd8(j) === 0xe8) {
                    const t = (j + 5 + rd32(j + 1)) >>> 0;
                    if (t > start && t < stop) {
                        return L.NewHook({ address: t, offset: L.stackoffset(1), type: L.USING_STRING }, 'Triangle');
                    }
                }
            }
        }
    }
    return false;
}

const E = L.engine({
    name: 'Triangle',
    check: { FILE: 'Execle.exe' },
    attach() {
        L.hookGDIFunctions();
        // trigger_fun (on TextOutA: the "Triangle2_TextOutA" hook of the enclosing function, やっぱり妹がすきっ！ and
        // MONSTER PARK) is not supported: left out
        return InsertTriangleHook();
    },
});

function InsertTrianglePixHook() {
    /*
     * Sample games:
     * https://vndb.org/v38070
     * https://vndb.org/v42090
     * https://vndb.org/v41025
     */
    const bytes = [
        0x50, // push eax           << hook here
        0xE8, ...XX4, // call FinalIgnition.exe+4DE10
        0x8B, 0x83, ...XX4, // mov eax,[ebx+0000DCA0]
        0x8D, 0x8D, ...XX4, // lea ecx,[ebp-0000022C]
        0x83, 0x7D, 0x44, 0x10, // cmp dword ptr [ebp+44],10
        0xFF, 0x75, 0x40, // push [ebp+40]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        index: 0,
        type: L.CODEC_UTF8 | L.USING_STRING | L.NO_CONTEXT,
        filter_fun: L.NewLineCharToSpaceA,
    }, 'TrianglePix');
}

function Triangle2_attach_function() {
    const bytes = [
        0x0f, 0x57, XX,
        0x68, 0x0F, 0x27, 0x00, 0x00,
        0x0f, 0x57, XX];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(5),
        type: L.USING_STRING | L.CODEC_UTF8 | L.NO_CONTEXT,
    }, 'triangle');
}

const E2 = L.engine({
    name: 'Triangle2',
    check: { FILE_ALL: ['pix.bin', 'pix.xml'] },
    attach() { return Triangle2_attach_function() || InsertTrianglePixHook(); },
});

function TriangleM1() {
    // `auto _ = L"${FirstName}"` is a pointer in C++, so sizeof(_) is 4: only L"${" is searched
    let addr = L.findBytes(L.wToBytes('${'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;

    const pushoffset = [0x68, ...L.le32(addr)];
    addr = L.findBytes(pushoffset, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(2),
        type: L.USING_STRING | L.CODEC_UTF16,
    }, 'TriangleM');
}

function TriangleM2() {
    const bytes = [0x33, 0xff, 0x66, 0x39, 0x3b, 0x74];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr,
        offset: L.regoffset('ebx'),
        type: L.USING_STRING | L.CODEC_UTF16 | L.NO_CONTEXT,
    }, 'TriangleM');
}

// L"fsroot_\\common\\app_info.rson" with _[6] = L'0' + i: index 6 is the '_', so the names are fsroot0 .. fsroot9
const triangleMFiles = Array.from({ length: 10 }, (_, i) => 'fsroot' + i + '/common/app_info.rson');
const E3 = L.engine({
    name: 'TriangleM',
    check: () => triangleMFiles.some((f) => L.CheckFile(f)),
    files: triangleMFiles,
    attach() {
        // 蛇香のライラ ～Allure of MUSK～ 第一夜 ヨーロピアン・ナイト 体験版
        const _1 = TriangleM1();
        const _2 = TriangleM2();
        return _1 || _2;
    },
});

module.exports = [E, E2, E3];
if (!module.parent) { L.run(E); L.run(E2); L.run(E3); }
