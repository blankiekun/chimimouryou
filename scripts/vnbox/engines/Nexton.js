// Nexton.js: LunaHook's Nexton engines (Nexton, Nexton1) for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Nexton.cpp and Nexton.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the EMBED flags and embed_hook_font of EmbedNexton and NEXTON2; the #if 0 first search of InsertNextonHook.
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/**
 *  jichi 9/5/2013: NEXTON games with aInfo.db
 *  Sample games:
 *  - /HA-C@4D69E:InnocentBullet.exe (イノセントバレッド)
 *  - /HA-C@40414C:ImoutoBancho.exe (妹番長)
 *
 *  New (11/7/2013):
 *  /HA-20:4@583DE:MN2.EXE (NEW)
 *  - length_offset: 1, off: -0x24, split: 4, type: 84 (0x54)
 */
function InsertNextonHook() {
    const bytes = [
        0x57,                   // 0044d696   57               push edi
        0x8b, 0xc3,             // 0044d697   8bc3             mov eax,ebx
        0xe8, ...XX4,           // 0044d699   e8 6249fdff      call .00422000
        0x89, 0x44, 0x24, 0x18, // 0044d69e   894424 18        mov dword ptr ss:[esp+0x18],eax ; jichi: this is the ith hook point
        0x85, 0xc0,             // 0044d6a2   85c0             test eax,eax
        0x0f, 0x84,             // c2feffff    // 0044d6a4  ^0f84 c2feffff    je .0044d56c
    ];
    const addr_offset = 0x0044d69e - 0x0044d696; // = 8
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        return false;
    }

    // CheatEngine search for byte array: 8944241885C00F84
    return L.NewHook({
        address: addr + addr_offset,
        offset: L.regoffset('edi'),
        split: L.stackoffset(1),
        type: L.CODEC_ANSI_BE | L.USING_SPLIT, // 0x54
    }, 'NEXTON');
}

// ScenarioHook. Scenario caller; roles: OtherRole 0, NameRole 1, ScenarioRole 2 (the split value)
function hookBefore(s, hp, buffer, role) {
    const text = s.stack[1]; // arg1
    if (!text || !L.u8(text))
        return;
    role.value = 0;
    const retaddr = s.stack[0];
    const ins = L.u8(retaddr);
    if (ins === 0xa1) // 0047D564   A1 0C839800      MOV EAX,DWORD PTR DS:[0x98830C]
        role.value = 2;
    else if (ins === 0x5f) // 0047D5A4   5F               POP EDI
        role.value = 1;

    buffer.fromCharPtr(text);
}

/**
 *  Sample game: Innocent Bullet
 *  Name/Scenario/History are translated in different callers.
 */
function attachScenario(startAddress, stopAddress) {
    const bytes = [
        0x57,                   // 0044d696   57               push edi
        0x8b, 0xc3,             // 0044d697   8bc3             mov eax,ebx
        0xe8, ...XX4,           // 0044d699   e8 6249fdff      call .00422000
        0x89, 0x44, 0x24, 0x18, // 0044d69e   894424 18        mov dword ptr ss:[esp+0x18],eax ; jichi: this is the ith hook point
        0x85, 0xc0,             // 0044d6a2   85c0             test eax,eax
        0x0f, 0x84,             // c2feffff    // 0044d6a4  ^0f84 c2feffff    je .0044d56c
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr); // range is around 50, use 80
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.NO_CONTEXT,
        offset: L.stackoffset(1),
        text_fun: hookBefore,
    }, 'EmbedNexton');
}

/** jichi 8/17/2014 Nexton1
 *  Sample games:
 *  - [Nomad][071026] 淫烙の巫女 Trial
 *
 *  Debug method: text are prefetched into memory. Add break point to it.
 *  The shortest function was picked: it takes two arguments, text address is in arg1.
 */
function InsertNexton1Hook() {
    const bytes = [
        0x56,                   // 00419750   56               push esi    ; jichi: hook here, text in arg1
        0x8b, 0x74, 0x24, 0x08, // 00419751   8b7424 08        mov esi,dword ptr ss:[esp+0x8]
        0x8b, 0xc6,             // 00419755   8bc6             mov eax,esi
        0x57,                   // 00419757   57               push edi
        0x8d, 0x78, 0x01,       // 00419758   8d78 01          lea edi,dword ptr ds:[eax+0x1]
        0xeb, 0x03,             // 0041975b   eb 03            jmp short inrakutr.00419760
        0x8d, 0x49, 0x00,       // 0041975d   8d49 00          lea ecx,dword ptr ds:[ecx]
        0x8a, 0x10,             // 00419760   8a10             mov dl,byte ptr ds:[eax] ; jichi: eax is the text
        0x83, 0xc0, 0x01,       // 00419762   83c0 01          add eax,0x1
        0x84, 0xd2,             // 00419765   84d2             test dl,dl
        0x75, 0xf7,             // 00419767  ^75 f7            jnz short inrakutr.00419760
        0x2b, 0xc7,             // 00419769   2bc7             sub eax,edi
        0x50,                   // 0041976b   50               push eax
        0x56,                   // 0041976c   56               push esi
        0x83, 0xc1, 0x04,       // 0041976d   83c1 04          add ecx,0x4
    ];
    const addr_offset = 0; // distance to the beginning of the function
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr) {
        return false;
    }

    return L.NewHook({
        address: addr + addr_offset,
        offset: L.stackoffset(1), // [esp+4] == arg0
        type: L.USING_STRING,
    }, 'NEXTON1');
}

// 真・恋姫†無双～乙女繚乱☆三国志演義～
function h2() {
    const bytes = [
        0x8b, 0xf8,
        0x0f, 0xb6, 0x3f,
        0x03, 0xfb,
        0x0f, 0x84, ...XX4,
        0x83, 0xff, 0x0a,
        0x0f, 0x84, ...XX4,
        0x83, 0xff, 0x20,
        0xd9, 0x44, 0x24, XX,
        0x0f, 0x84, ...XX4,
        0x81, 0xff, 0x40, 0x81, 0x00, 0x00];
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr, 0xd0);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        offset: L.stackoffset(1),
        split: L.stackoffset(4),
        type: L.USING_STRING | L.USING_SPLIT,
        filter_fun(buffer) {
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\n(?!\x81\x40)`);
            buffer.fromA(s);
        },
    }, 'NEXTON2');
}

const E = L.engine({
    name: 'Nexton',
    certain: false,
    check: () => L.CheckFile('aInfo.db') ||
        L.CheckFileAll(['cfg.cfg', 'SystemConfig.exe', 'data.arc', 'se_000.arc', 'voice_000.arc']),
    files: ['aInfo.db'],
    attach() {
        const embed = attachScenario(L.processStartAddress, L.processStopAddress);
        return InsertNextonHook() || embed;
    },
});

const E1 = L.engine({
    name: 'Nexton1',
    // old nexton game
    check: { FILE: 'comnArc.arc' },
    certain: false,
    attach() {
        return h2() | InsertNexton1Hook();
    },
});

module.exports = [E, E1];
if (!module.parent) L.run(E);
