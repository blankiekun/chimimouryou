// Minori.js: LunaHook's Minori engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Minori.cpp and Minori.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
// Not ported: the embed parts of ScenarioHook (hookafter, hookAfter, embed_fun, embed_hook_font, the EMBED flags).
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

function Minori1EngFilter(buffer) {
    L.StringCharReplacerA(buffer, '\\n', ' ');
    L.StringFilterA(buffer, '\\a');
    L.StringFilterA(buffer, '\\v');
    L.CharReplacerA(buffer, '\xC4', '-');
    L.CharReplacerA(buffer, '\x93', '"');
    L.CharReplacerA(buffer, '\x94', '"');
    L.CharReplacerA(buffer, '\x92', '\'');
    L.StringCharReplacerA(buffer, '\\I', '\'');
    L.StringCharReplacerA(buffer, '\\P', '\'');
}

function Minori1JapFilter(buffer) {
    L.StringFilterA(buffer, '\\a');
    L.StringFilterA(buffer, '\\v');
    L.StringFilterA(buffer, '\\N');

    if (buffer.viewA().includes('{')) {
        L.StringFilterBetweenA(buffer, '{', '}');
    }
}

function InsertMinori1Hook() {
    /*
     * Sample games:
     * https://vndb.org/v19644
     * https://vndb.org/v12562
     */
    const bytes = [
        0x84, 0xC0,         // test al,al                      << hook here
        0x0F, 0x85, ...XX4, // jne trinoline_en_AA.exe+243E1
        0x68, ...XX4,       // push trinoline_en_AA.exe+118BF8 << alt eng hook
        0x33, 0xFF,         // xor edi,edi
    ];
    const alt_addr_offset = 8;

    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }

    const hp = {
        address: addr,
        offset: L.regoffset('edx'),
        codepage: 932,
        type: L.USING_STRING | L.BREAK_POINT,
        filter_fun: Minori1JapFilter,
    };
    let succ = L.NewHook(hp, 'Minori1');

    hp.address = addr + alt_addr_offset;
    hp.filter_fun = Minori1EngFilter;
    succ = L.NewHook(hp, 'Minori1eng') || succ;

    return succ;
}

function Minori2Filter(buffer) {
    L.StringCharReplacerA(buffer, '\\n', ' ');

    if (buffer.viewA().includes('{')) {
        L.StringFilterBetweenA(buffer, '{', '}');
    }
}

function InsertMinori2Hook() {
    /*
     * Sample games:
     * https://vndb.org/v35
     */
    const bytes = [
        0x80, 0x38, 0x00,                   // cmp byte ptr [eax],00  << hook here
        0x0F, 0x84, ...XX4,                 // je WindRP.exe+2832A
        0xB8, 0x20, 0x03, 0x00, 0x00,       // mov eax,00000320
        0x89, 0x44, 0x24, 0x10,             // mov [esp+10],eax
        0x89, 0x44, 0x24, 0x14,             // mov [esp+14],eax
        0x8B, 0x47, 0x20,                   // mov eax,[edi+20]
    ];
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr) {
        return false;
    }

    return L.NewHook({
        address: addr,
        offset: L.regoffset('eax'),
        type: L.USING_STRING,
        filter_fun: Minori2Filter,
    }, 'Minori2');
}

function InsertMinoriHooks() {
    return InsertMinori1Hook() || InsertMinori2Hook();
}

// ScenarioHook (Sample game: 12の月のイヴ, ソレヨリノ前奏詩)
const isalpha = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

// Remove \tag and leading #. Returns [offset, size] of the trimmed text in `text`.
function trim(text) {
    let start = 0, length = text.length;
    // handle prefix
    while (text.charCodeAt(start) === 0x23 || text.charCodeAt(start) === 0x40) { // '#' '@'
        start++;
        length--;
    }
    while (text.charCodeAt(start) === 0x5c && isalpha(text.charCodeAt(start + 1))) { // '\\'
        start += 2;
        length -= 2;
    }
    // handle suffix
    while (length >= 2 && text.charCodeAt(start + length - 2) === 0x5c && isalpha(text.charCodeAt(start + length - 1)))
        length -= 2;
    return [start, length];
}

const addr_role = new Map(); // retaddr -> role (Engine::NameRole = 1, ScenarioRole = 2; OtherRole = 0)
const NameRole = 1, ScenarioRole = 2;

// TextUnionA (util/textunion.h): chars[16] or text pointer at 0x0, size at 0x10, capacity at 0x14
function textUnionA(arg) {
    const size = L.u32(arg + 0x10), capacity = L.u32(arg + 0x14);
    const text = capacity < 0x10 ? arg : L.u32(arg);
    if (size <= 0 || size > capacity) return null;
    if (!L.isAddressReadable(text, size) || L.strlen(text) !== size) return null;
    return L.readA(text, size);
}

function hookBeforehookBefore(s, hp, buffer, role) {
    const arg = s.stack[0]; // arg1
    if (!arg) return;
    const vw = textUnionA(arg);
    if (vw === null) return;
    if (L.all_ascii(vw)) return;
    const [start, size] = trim(vw);
    if (!size || !vw.charCodeAt(start)) return;
    let oldData = vw.substr(start, size);
    const retaddr = s.stack[0];
    role.value = addr_role.get(retaddr) || 0;
    if (role.value === NameRole)
        oldData = L.strReplace(oldData, '\x81\x40'); // remove spaces in the middle of names

    buffer.fromA(oldData);
}

function attachScenario(startAddress, stopAddress) {
    const bytes = [
        0x8b, 0xc6, // 01052ada   8bc6             mov eax,esi	; jichi: esi is target address
        0x57,       // 01052adc   57               push edi	; jichi: source size
        0x03, 0xcb, // 01052add   03cb             add ecx,ebx
        0x51,       // 01052adf   51               push ecx	; jichi: source
        0x50,       // 01052ae0   50               push eax	; jichi: target
    ];
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;

    let count = false;
    const fun = (addr) => {
        // 013BEFFA   E8 313AFAFF      CALL yorino_t.01362A30  ; jichi: name call
        // 013BF017   E8 143AFAFF      CALL yorino_t.01362A30 ; jichi: scenario call
        const retaddr = addr + 5;
        let role = 0;
        switch (L.u32(retaddr)) {
            case 0x56184d8b:
                // 013BEFFF   8B4D 18          MOV ECX,DWORD PTR SS:[EBP+0x18]
                // 013BF002   56               PUSH ESI
                role = NameRole;
                break;
            case 0x01fc45c6: // 013BF01C   C645 FC 01       MOV BYTE PTR SS:[EBP-0x4],0x1
                if (L.u32(retaddr - 5 - 4) === 0x00D845C6) { // previous instruction
                    role = ScenarioRole;
                    break;
                }
            // fall through
            default:
                return true;
        }
        addr_role.set(retaddr, role);
        count = L.NewHook({
            address: addr,
            text_fun: hookBeforehookBefore,
            type: L.USING_STRING | L.NO_CONTEXT,
            filter_fun(buffer) {
                buffer.fromA(L.re.sub(buffer.strA(), String.raw`\{.*?\}`));
            },
        }, 'EmbedMinori') || count;
        return true; // replace all functions
    };
    L.iterNearCallAddress(fun, addr, startAddress, stopAddress);

    return count;
}

const E = L.engine({
    name: 'Minori',
    check: { FILE: '*.paz' },
    certain: false,
    attach() {
        const embed = attachScenario(L.processStartAddress, L.processStopAddress);
        return InsertMinoriHooks() || embed;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
