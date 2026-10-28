// Elf.js: LunaHook's Elf engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/Elf.cpp and Elf.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX2, XX4 } = L;

const VNR_TEXT_CAPACITY = 1500;

function _elf_strlen(p) { // limit search address which might be bad
    for (let i = 0; i < VNR_TEXT_CAPACITY; i++)
        if (!L.u8(p++))
            return i;
    return 0; // when len >= VNR_TEXT_CAPACITY
}

// TextUnionA *: text/chars at 0, size at 0x10, capacity at 0x14 (a std::string)
function textUnionAView(u) {
    const size = L.u32(u + 0x10), capacity = L.u32(u + 0x14);
    return [capacity < 0x10 ? u : L.u32(u), size];
}

function SpecialHookElf(context, hp, buffer, split) {
    const arg1 = context.stack[1];
    const arg2_scene = arg1 + 4 * 5,
        arg2_chara = arg1 + 4 * 10;
    let text;
    if (L.u32(arg2_scene) === 0) {
        text = L.u32(arg2_scene + 4 * 3);
        if (!text || L.IsBadReadPtr(text, 1)) // Text from scenario could be bad when open backlog while the character is speaking
            return;
        split.value = 1;
    } else if (L.u32(arg2_chara) === 0) {
        text = arg2_chara + 4 * 3;
        split.value = 2;
    } else
        return;
    buffer.from(text, _elf_strlen(text));
}

function InsertElfHook() {
    const bytes = [
        0x75, 0x0f, // 0093f9c0  |. 75 0f          jnz short silkys.0093f9d1
        0x8b, 0x45, 0x08, // 0093f9c2  |. 8b45 08        mov eax,dword ptr ss:[ebp+0x8]
        0x8b, 0x48, 0x04, // 0093f9c5  |. 8b48 04        mov ecx,dword ptr ds:[eax+0x4]
        0x8b, 0x91, 0x90, 0x00, 0x00, 0x00]; // 0093f9c8  |. 8b91 90000000  mov edx,dword ptr ds:[ecx+0x90]
    const range = Math.min(L.processStopAddress - L.processStartAddress, 0x00300000);
    let addr = L.findBytes(bytes, L.processStartAddress, L.processStartAddress + range);
    if (!addr)
        return false;

    const push_ebp = 0x55;
    for (let i = 0; i < 0x20; i++, addr--) // value of i is supposed to be 0xc or 0x10
        if (L.u8(addr) === push_ebp) { // beginning of the function
            return L.NewHook({
                address: addr,
                text_fun: SpecialHookElf,
                type: L.USING_STRING | L.NO_CONTEXT, // = 9
            }, 'Elf');
        }
    return false;
}

function __() {
    const bytes = [
        0x0F, 0xB7, XX, ...XX4]; // v11 == 30081 // movzx   edx, ds:word_4C285C //word_4C285C dw 7581h

    for (let addr of L.SearchMemory(bytes, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        const reg = L.u8(addr + 2);
        if ((reg !== 0x05) && (reg !== 0x0d) && (reg !== 0x1d) && (reg !== 0x15))
            continue;
        const word_4C285C_addr = L.i32(addr + 3);
        if (word_4C285C_addr < L.processStartAddress || word_4C285C_addr > L.processStopAddress)
            continue;
        const word_4C285C = L.i32(word_4C285C_addr);
        if ((word_4C285C) !== 0x7581)
            continue;
        addr = L.findfuncstart(addr, 0x200);
        if (!addr)
            continue;
        return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'aiwin6');
    }

    return false;
}

// ScenarioHook (EmbedElf): hooks every call of the text function and reads the scenario / name text; the
// hookafter1 / hookAfter hooks (embedding, restoring the text pointer) and the role guess are left out.
// TextArgument (arg1 at stack[0]): scenarioFlag +4*5 (0 if scenario), scenarioText +4*5+4*3, nameFlag +4*10
// (0 if it is name), nameText (inline chars) +4*10+4*3.
function ScenarioHookHookBefore(s, hp, buffer) {
    const arg = s.stack[0]; // arg1 on the top of the stack

    if (L.u32(arg + 4 * 5) === 0) {
        const text = L.u32(arg + 4 * 5 + 4 * 3);
        if (!L.isAddressReadable(text))
            return;
        buffer.fromCharPtr(text);
    } else if (L.u32(arg + 4 * 10) === 0) {
        buffer.fromCharPtr(arg + 4 * 10 + 4 * 3);
    }
}

function ScenarioHookAttach(startAddress, stopAddress) {
    const bytes = [
        0x75, 0x0f, // 0093f9c0  |. 75 0f          jnz short silkys.0093f9d1
        0x8b, 0x45, 0x08, // 0093f9c2  |. 8b45 08        mov eax,dword ptr ss:[ebp+0x8]
        0x8b, 0x48, 0x04, // 0093f9c5  |. 8b48 04        mov ecx,dword ptr ds:[eax+0x4]
        0x8b, 0x91, 0x90, 0x00, 0x00, 0x00]; // 0093f9c8  |. 8b91 90000000  mov edx,dword ptr ds:[ecx+0x90]
    let addr = L.findBytes(bytes, startAddress, stopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    let count = 0;
    const fun = (addr) => {
        const succ = L.NewHook({
            address: addr,
            text_fun: ScenarioHookHookBefore,
            type: L.USING_STRING | L.NO_CONTEXT,
        }, 'EmbedElf');
        count += 1;
        return succ; // replace all functions
    };
    L.iterNearCallAddress(fun, addr, startAddress, stopAddress);
    return count !== 0;
}

function elf3() {
    let succ = false;
    const sig = [
        0x83, XX, 0x14, 0x10,
        0x72, XX];
    for (const addr of L.SearchMemory(sig, L.PAGE_EXECUTE, L.processStartAddress, L.processStopAddress)) {
        const check1 = L.u8(addr + 5);
        if (check1 !== 0x02 && check1 !== 0x04)
            continue;
        const check = L.u8(addr + 1);
        succ = L.NewHook({
            address: addr,
            user_value: check,
            type: L.USING_STRING | L.NO_CONTEXT | L.BREAK_POINT, // 有壳minhook太慢了
            text_fun(context, hp, buffer) {
                let ptr;
                switch (hp.user_value) {
                case 0x7a:
                    ptr = context.edx;
                    break;
                case 0x7b:
                    ptr = context.ebx;
                    break;
                case 0x79:
                    ptr = context.ecx;
                    break;
                case 0x78:
                    ptr = context.eax;
                    break;
                case 0x7e:
                    ptr = context.esi;
                    break;
                case 0x7f:
                    ptr = context.edi;
                    break;
                case 0x7d:
                    ptr = context.ebp;
                    break;
                default:
                    hp.type = L.HOOK_EMPTY;
                    return; // LunaHook goes on with an uninitialised ptr here
                }
                const [at, size] = textUnionAView(ptr);
                buffer.from(at, size);
            },
            filter_fun: L.all_ascii_Filter,
        }, 'elf3') || succ;
    }
    return succ;
}

function elf4() {
    const bytes = [
        0x72, 0x02,
        0x8b, 0x36,
        0x8a, 0x0e,
        0x84, 0xc9,
        0x0f, 0x84, ...XX4,
        0x8d, 0x57, XX,
        0x8d, 0x5f, XX,
        0x8b, 0xff,
        0x80, 0xf9, 0x81,
        0x72, 0x05,
        0x80, 0xf9, 0x9f,
        0x76, 0x07,
        0x8d, 0x41, 0x20,
        0x3c, 0x0f,
        0x77, XX];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr + 4, type: L.USING_STRING, offset: L.regoffset('esi') }, 'Elf4');
}

function aijiemei4DL() {
    const sig = [
        0X55,
        0x8b, 0xec, // mov ebp,esp
        0x83, 0xec, 0x14, 0x53,
        0x56,
        0x8b, 0xf1,
        0x8b, 0x4d, 0x08,
        0x57,
        0x8a, 0x11,
        0x88, 0x55, 0xff,
        0x80, 0xfa, 0x81, // cmp dl,0x81
        0x72, 0x05,
        0x80, 0xfa, 0x9f, // cmp dl,0x9f
        0x76, 0x08,
        0x8a, 0xc2,
        0x04, 0x20,
        0x3c, 0x0f,
        0x77, 0x07,
        0xb8, 0x01, 0x00, 0x00, 0x00];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING | L.USING_SPLIT,
        offset: L.stackoffset(1),
        split: L.stackoffset(6),
    }, 'Elf5');
}

function nvxijiazu() {
    const sig = [
        0X55,
        0x8b, 0xec, // mov ebp,esp
        0x51, 0x53, 0x56,
        0x8b, 0xf1,
        0x66, 0xc7, 0x45, 0xfd, 0x00, 0x00,
        0x66, 0x8b, 0x4d, 0x10, // mov ecx,[ebp+10]
        0x66, 0x8b, 0xd1,
        0x66, 0xc1, 0xea, 0x08,
        0x80, 0xfa, 0x81, // cmp dl,0x81
        0x72, 0x05,
        0x80, 0xfa, 0x9f, // cmp dl,0x9f
        0x76, XX];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.USING_CHAR | L.CODEC_ANSI_BE | L.DATA_INDIRECT, // 不可以NO_CONTEXT，因为有彩色可点击文字，会在另一个context有很多垃圾文本
        offset: L.regoffset('esp'),
        index: 0x10,
    }, 'Elf4');
}

function malunohuanzhe() {
    const sig = [
        0x8b, 0x4e, 0x20,
        0x83, 0xf9, 0x10,
        0x72, 0x05,
        0x8b, 0x46, 0x0c,
        0xeb, 0x03,
        0x8d, 0x46, 0x0c,
        0x80, 0x3c, 0x18, 0x00,
        0x0f, 0x84, ...XX4,
        0x83, 0xf9, 0x10,
        0x72, 0x05,
        0x8b, 0x46, 0x0c,
        0xeb, 0x03,
        0x8d, 0x46, 0x0c,
        0x8a, 0x04, 0x18,
        0x3c, 0x81,
        0x72, 0x04,
        0x3c, 0x9f,
        0x76, 0x06,
        0x04, 0x20,
        0x3c, 0x0f,
        0x77, XX];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = ((addr) => {
        const addr1 = L.findEnclosingAlignedFunction(addr);
        if (!addr1)
            return 0;
        const addr2 = L.findfuncstart(addr);
        if (!addr2)
            return 0;
        if (addr2 === addr1)
            return addr2;
        return 0;
    })(addr);
    if (!addr)
        return false;
    // embed_fun (text->setText) is left out
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer) {
            const a2 = context.stack[1];
            const [at, size] = textUnionAView(a2 + 12); // TextUnionA *
            buffer.from(at, size);
        },
    }, 'elf5');
}

function avking() {
    const bytes = [
        0x83, 0x3d, ...XX4, 0x01,
        0x0f, 0x85, ...XX4,
        0xa1, ...XX4,
        0x8b, 0x0d, ...XX4,
        0x8b, 0x04, 0x88,
        0x85, 0xc0,
        0x74, XX,
        0x50,
        0xe8, ...XX4];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.NO_CONTEXT | L.USING_STRING }, 'elf6');
}

function ai6win() {
    if (L.processName_lower !== 'ai6win.exe')
        return false;
    const bytes = [
        0x83, 0xec, 0x14,
        0x8b, 0x44, 0x24, 0x18,
        0x8a, 0x00,
        0x3c, 0x81,
        0x53,
        0x55,
        0x56,
        0x57,
        ...XX2,
        ...XX4,
        0x72, 0x04,
        0x3c, 0x9f,
        0x76, 0x06,
        0x04, 0x20,
        0x3c, 0x0f,
        0x77, 0x07,
        0xb8, 0x01, 0x00, 0x00, 0x00,
        0xeb, 0x02];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'elf7');
}

function Hyakki() {
    const symbol = L.aToBytes('\x81\x76\x81\x78\x81\x7a\x81\x45\x81\x48\x81\x49\0');
    let addr = L.findBytes(symbol, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    const bytes = [
        0x66, 0xc1, 0xc0, 0x08,
        0xf3, 0x0f, 0x7e, 0x05, ...XX4,
        0x57];
    bytes.splice(8, 4, ...L.le32(addr)); // *(int *)(bytes + 8) = addr
    addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr, 0x80);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, type: L.USING_CHAR | L.CODEC_ANSI_BE, offset: L.stackoffset(1) }, 'Elf8');
}

function Elfattach_function(type) {
    if (type === 1) {
        const _1 = InsertElfHook() || __() || elf4() || nvxijiazu() || malunohuanzhe() || aijiemei4DL() || Hyakki() || elf3() || ai6win();
        return ScenarioHookAttach(L.processStartAddress, L.processStopAddress) || _1;
    } else if (type === 2) {
        return avking();
    }
    return false;
}

function SpecialHookElf2(context, hp, buffer, split) {
    const eax = context.eax;
    const edx = context.edx;
    const c = L.u16(eax + edx);
    if (L.IsShiftjisWord(c) === false) {
        return;
    }
    split.value = context.stack[1];
    buffer.from_t(c, 2);
}

function Elf2attach_function() {
    const bytes = [
        0x53,
        0x8a, 0x1c, 0x02,
        0x8b, 0x54, 0x24, 0x08,
        0x03, 0xc2];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr + 1, text_fun: SpecialHookElf2, type: L.NO_CONTEXT | L.USING_CHAR }, 'Elf');
}

function elf2() {
    const bytes = [
        0x66, 0x8b, 0x8e, ...XX4,
        0x66, 0x8b, 0x96, ...XX4,
        0x66, 0x01, 0x8e, ...XX4,
        0x66, 0x89, 0x96, ...XX4,
        0x8b, 0x06,
        0x6a, 0x00,
        0x8b, 0xce,
        0xff, 0x50, 0x08,
        0x84, 0xc0];
    const addr = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    const hp = {};

    hp.type = L.NO_CONTEXT | L.USING_CHAR;
    hp.offset = L.regoffset('ebx');

    const bytes2 = [
        0x66, 0x33, 0xdb,
        0x6a, 0x01,
        0x8a, 0xd8,
        0x8b, 0x06,
        0x8b, 0xce,
        0xff, 0x50, 0x08,
        0x33, 0xc9,
        0x33, 0xd2,
        0x8a, 0xe8,
        0x0b, 0xd9];
    const addr2 = L.reverseFindBytes(bytes2, addr - 0x100, addr);
    if (addr2) {
        hp.address = addr2 + bytes2.length;
    } else {
        hp.address = addr + bytes.length;
    }
    return L.NewHook(hp, 'Elf');
}

function _h1() {
    const sig = [
        0x33, 0xff,
        0x8b, 0x06,
        0x8b, 0xce,
        0x6a, 0x01,
        0x8b, 0x40, 0x08,
        0xff, 0xd0,
        0x0f, 0x0b6, 0xc0,
        0x8b, 0xce,
        0x66, 0xc1, 0xe0, 0x08,
        0x0f, 0xb7, 0xc0,
        0x89, 0x45, 0xfc,
        0x8b, 0x06,
        0x6a, 0x01,
        0x8b, 0x40, 0x08,
        0xff, 0xd0,
        0x0f, 0xb6, 0xc0,
        0x8b, 0xce,
        0x66, 0x09, 0x45, 0xfc,
        0xff, 0x75, 0xfc,
        0xe8];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr + sig.length - 1,
        type: L.NO_CONTEXT | L.USING_CHAR | L.DATA_INDIRECT | L.CODEC_ANSI_BE,
        offset: L.regoffset('ebp'),
        index: -4,
    }, 'Elf');
}

function _h2() {
    const sig = [
        0x33, 0xc5,
        0x89, 0x45, 0xfc,
        0x8a, 0x81, ...XX4,

        0x84, 0xc0,
        0x75, 0x0e,
        0x8b, 0x81, ...XX4,
        0x03, 0x81, ...XX4,
        0xeb, XX,

        0x3c, 0x01,
        0x75, 0x0e,
        0x8b, 0x81, ...XX4,
        0x03, 0x81, ...XX4,
        0xeb, XX,

        0x3c, 0x02,
        0x75, 0x0e,
        0x8b, 0x81, ...XX4,
        0x03, 0x81, ...XX4,
        0xeb, XX];
    let addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, type: L.NO_CONTEXT | L.USING_CHAR | L.CODEC_ANSI_BE, offset: L.stackoffset(1) }, 'Elf');
}

function all() {
    const a = _h1();
    const b = _h2();
    return a || b;
}

function el() {
    const sig = [
        0x66, 0xc1, 0xe8, 0x08,
        XX, // 0x57
        0x3c, 0x81,
        0x72, 0x04,
        0x3c, 0x9f,
        0x76, 0x08,
        0x3c, 0xe0,
        0x72, 0x10,
        0x3c, 0xef,
        0x77, 0x0c];
    const addr = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    return L.NewHook({ address: addr, type: L.NO_CONTEXT | L.USING_CHAR | L.CODEC_ANSI_BE, offset: L.regoffset('eax') }, 'Elf');
}

function deja() {
    const sig = [
        0x66, 0xc1, 0xe8, 0x08,
        0x3c, 0x81,
        XX, // 0x57
        XX, ...XX4, // 0xc6,0x44,0x24,0x11,0x00
        XX, ...XX4, // 0xc6,0x44,0x24,0x12,0x00
        0x72, 0x04,
        0x3c, 0x9f,
        0x76, 0x16,
        0x3c, 0xe0,
        0x72, 0x04,
        0x3c, 0xef,
        0x76, 0x0e,
        0x3c, 0xfa,
        0x72, 0x04,
        0x3c, 0xfc,
        0x76, 0x06];
    const addr2 = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr2)
        return false;
    let addr = L.reverseFindBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr)
        return false;
    if (addr2 === addr) {
        return false;
    }
    addr = L.findEnclosingAlignedFunction(addr, 0x18);
    if (!addr)
        return false;
    return L.NewHook({
        address: addr,
        type: L.CODEC_ANSI_BE | L.USING_CHAR,
        text_fun(context, hp, buffer, split) {
            split.value = context.stack[2] > 8 ? 1 : 0;
            buffer.from_t(context.stack[3] & 0xffff, 2);
        },
    }, 'deja');
}

function koihime() {
    const sig = [
        0x55, 0x8b, 0xec,
        0x83, 0xec, 0x08,
        0x89, 0x4d, 0xf8,
        0x66, 0x8b, 0x45, 0x08,
        0xd0, 0xe4,
        0x2c, 0x1f,
        0x78, 0x04,
        0x3c, 0x61,
        0x14, 0xde,
        0x66, 0x05, 0xa1, 0x1f,
        0x66, 0x25, 0x7f, 0x7f,
        0x66, 0x89, 0x45, 0xfc,
        0x66, 0x8b, 0x45, 0xfc,
        0x8b, 0xe5,
        0x5d,
        0xc2, 0x04, 0x00];
    const addr2 = L.findBytes(sig, L.processStartAddress, L.processStopAddress);
    if (!addr2)
        return false;
    return L.NewHook({ address: addr2, type: L.CODEC_ANSI_BE | L.USING_CHAR, offset: L.stackoffset(1) }, 'koihime');
}

function Elf2attach_functions() {
    const _ = elf2() || Elf2attach_function() || all() || el() || deja() || koihime();
    if (!_)
        L.hookGDIFunctions(L.FindFunction('TextOutA'));
    return _;
}

let type = 0, ai5win = false; // set by the check, as the C++ members
const E = L.engine({
    name: 'Elf',
    check: () => {
        ai5win = L.CheckFile('Ai5win.exe') && L.CheckFileAny(['data.arc', 'MISC\\data.arc']) && (L.CheckFileAny(['mes.arc', 'MISC\\mes.arc']));
        if (L.CheckFileAll(['data.arc', 'mes.arc']) &&
            L.CheckFileAny(['effect.arc', 'effect.awf'])) {
            // flutter of birds～鳥達の羽ばたき～ WIN10版本 (https://vndb.org/v2379), 愛のチカラ -> effect.awf (https://vndb.org/v2307)
            type = 1;
        } else if (L.CheckFileAll(['*.scx', 'data/cg/cg.bin', 'data/cg/cg.pak', 'data/cg/hiz/*.hiz'])) {
            //[060127][エルフ] AVキング (mdf+mds)
            type = 2;
        }

        return !!(type || ai5win);
    },
    attach() {
        const a = Elfattach_function(type);
        const b = ai5win && Elf2attach_functions();
        return a || b;
    },
});

const E2 = L.engine({
    name: 'ElfFunClubFinal',
    certain: false,
    check: () => L.processName_lower === 'fanclub.exe',
    attach() {
        let succ = false;
        for (let addr of L.findiatcallormov_all(L.FindFunction('TextOutA'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE, XX)) {
            const s = [XX, 0xCC, 0xCC, 0xCC];
            addr = L.reverseFindBytes(s, addr - 0x100, addr);
            if (!addr)
                continue;
            succ = L.NewHook({
                address: addr + 4,
                type: L.CODEC_ANSI_BE | L.USING_CHAR,
                text_fun(context, hp, buffer, split) {
                    split.value = context.stack[2] > 8 ? 1 : 0;
                    buffer.from_t(context.stack[3] & 0xffff, 2);
                },
            }, 'ElfFunClubFinal') || succ;
        }
        return succ;
    },
});

module.exports = [E, E2];
if (!module.parent) L.run([E, E2]);
