// ApricoT.js: LunaHook's ApRicoT, ApRicoTlast and ApRicoTOld engines for VNBox (libLuna.js runs them).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/ApricoT.cpp and ApRicoT.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4, XX2 } = L;

// Apricot hook: the game folder contains arc.a*. This engine is heavily based on new DirectX interfaces.
// The game processes script encoded in a UTF32-like format. Only name and text data is needed.

// lru_cache<std::string> cache(n): touch(s) is true when s is cached (and refreshes it), else it inserts s
function lruCache(max) {
    const items = [];
    return {
        touch(s) {
            const i = items.indexOf(s);
            if (i >= 0) {
                items.splice(i, 1);
                items.push(s);
                return true;
            }
            items.push(s);
            if (items.length > max) items.shift();
            return false;
        },
    };
}

// jichi 2/15/2015: the script is an array of DWORDs, each a character of the line
function SpecialHookApRicoT(context, hp, buffer, split) {
    const reg_esi = context.esi;
    const base = L.u32(reg_esi + 0x24);
    const index = L.u32(reg_esi + 0x3c);
    let script = (base + index * 4) >>> 0; // DWORD *script
    const sc = (i) => L.u32(script + i * 4);
    // jichi 2/14/2015: split by the return address (relative)
    const arg = context.stack[16];
    split.value = arg > L.processStartAddress ? arg - L.processStartAddress : arg; // use relative split value
    if (sc(0) === 0x3c) { // L'<'
        let end = script;
        while (L.u32(end) !== 0x3e) end += 4; // L'>'
        switch (sc(1)) {
        case 0x4e: // L'N'
            if (sc(2) === 0x61 && sc(3) === 0x6d && sc(4) === 0x65) { // "ame"
                let s = '';
                for (script += 5 * 4; script < end; script += 4)
                    if (L.u32(script) > 0x20) s += String.fromCharCode(L.u32(script) & 0xFFFF);
                buffer.fromW(s);
                // jichi 1/4/2014: shift 16 to tell the name from the text script
                split.value = (split.value | (1 << 16)) >>> 0;
            }
            break;
        case 0x54: // L'T'
            if (sc(2) === 0x65 && sc(3) === 0x78 && sc(4) === 0x74) { // "ext"
                let s = '';
                for (script += 5 * 4; script < end; script += 4) {
                    if (L.u32(script) > 0x40) {
                        while (L.u32(script) === 0x7b) { // L'{'
                            script += 4;
                            while (L.u32(script) !== 0x5c) { // L'\\'
                                s += String.fromCharCode(L.u32(script) & 0xffff);
                                script += 4;
                            }
                            while (L.u32(script) !== 0x7d) script += 4; // L'}'
                            script += 4;
                        }
                        s += String.fromCharCode(L.u32(script) & 0xffff);
                    }
                }
                buffer.fromW(s);
            }
            break;
        }
    }
}

function InsertApRicoTHook() {
    // a hand-written loop over the code, as in C++: cmp reg,0x3c then retn 4 within 0x100 bytes
    const { bytes: b, base } = L.region(L.processStartAddress, L.processStopAddress);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    const id = (a) => (a >= base && a - base + 4 <= b.length ? dv.getUint32(a - base, true) : 0);
    for (let i = L.processStartAddress + 0x1000; i < L.processStopAddress - 4; i++) {
        if ((id(i) & 0xfff8fc) === 0x3cf880) { // cmp reg,0x3c
            for (let j = i + 3, k = i + 0x100; j < k; j++) {
                if ((id(j) & 0xffffff) === 0x4c2) { // retn 4
                    return L.NewHook({
                        address: j + 3,
                        text_fun: SpecialHookApRicoT,
                        type: L.USING_STRING | L.NO_CONTEXT | L.CODEC_UTF16,
                    }, 'ApRicoT');
                }
            }
        }
    }
    return false;
}

// https://vndb.org/v1285
function ApRicoTOld2() {
    const bytes = [
        0x33, 0xed,
        0x39, 0x6c, ...XX2,
        0x0f, 0x8e, ...XX4,
        // <==
        0x8b, 0x9c, 0x24, ...XX4,
        0x8d, 0x4e, 0x04,
        0x89, 0x4c, ...XX2,
        0xeb, 0x0b];
    const addrX = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addrX) return false;
    let lastname = ''; // static std::string lastname
    const cache = lruCache(4); // static lru_cache<std::string> cache(4)
    let last = ''; // static std::string last
    const parse = (s) => L.strReplace(s, '\x81\x40');
    return L.NewHook({
        address: addrX + 2 + 4 + 6,
        type: L.USING_STRING | L.NO_CONTEXT,
        text_fun(context, hp, buffer, split) {
            const ret = context.retaddr;
            if (ret === 0) return;
            const v7 = context.esi; // DWORD *
            const v34 = v7 + 4;
            let str = '';
            for (let v21 = 0; v21 < L.u32(v7 + 5 * 4); v21++) {
                const v22 = L.u32(v7 + 6 * 4) < 4 ? v34 : L.u32(v34);
                const v23 = L.u32(v22 + v21 * 4);
                str += String.fromCharCode((v23 >> 8) & 0xff, v23 & 0xff); // _byteswap_ushort, then its 2 bytes
            }
            if (ret > 0x10000) {
                if (str === lastname) return;
                lastname = str;
                buffer.fromA(str);
            } else {
                if (cache.touch(str)) {
                    last = str;
                    return;
                }
                if (str.startsWith(last)) {
                    buffer.fromA(parse(str.substr(last.length)));
                    last = str;
                } else {
                    last = str;
                    buffer.fromA(parse(str));
                }
            }
        },
    }, 'ApRicoTOld2');
}

function ApRicoTOldH() {
    // [040130][APRICOT] Maple Colors H (bin+cue)
    const bytes = [
        0x8b, 0x4c, 0x24, XX,
        0x8b, 0x44, 0x24, XX,
        0x2b, 0xc8,
        0x32, 0xdb,
        0x33, 0xff,
        0xd1, 0xf9,
        0x0f, 0x84, ...XX4];
    const addrX = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    if (!addrX) return false;
    let name = ''; // static std::string name
    let last = ''; // static std::string last
    const parse = (s) => L.strReplace(s, '\x81\x40');
    return L.NewHook({
        address: addrX + 8,
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            const ret = context.retaddr;
            if (ret !== 0 && ret !== 0x15d800) return;
            const ecx = context.ecx;
            const eax = context.eax;
            let str = '';
            for (let edi = 0; edi !== (((ecx - eax) | 0) >> 1); edi++) {
                const ax = L.u16(eax + edi * 2);
                if (ax === 0xa) continue;
                str += String.fromCharCode(ax >> 8, ax & 0xff); // _byteswap_ushort, then its 2 bytes
            }
            if (ret === 0x15d800) {
                name = str;
            } else {
                if (last.length && str.startsWith(last)) {
                    buffer.fromA(parse(str.substr(last.length)));
                    name = '';
                } else {
                    buffer.fromA(name + parse(str));
                }
                last = str;
            }
        },
    }, 'ApRicoTOld');
}

function ayakashi() {
    const bytes = [
        // ayakashi H
        0x8d, 0x69, 0x04,
        0xeb, 0x04,
        //
        0x8b, 0x4c, 0x24, 0x10,
        //
        0x8b, 0x51, 0x18,
        0x83, 0xfa, 0x10,
        0x72, 0x05,
        0x8b, 0x45, 0x00,
        0xeb, 0x02,
        //
        0x8b, 0xc5,
        //
        0x8a, XX, XX,
        0x8a, XX,
        0x80, XX, 0x20,
        0x80, XX, 0x5f,
        0x80, XX, 0x3b];
    let addrX = L.findBytes(bytes, L.processStartAddress, L.processStopAddress);
    let isH = true;
    if (!addrX) {
        const bytes2 = [
            // ayakashi
            0xc7, 0x44, 0x24, XX, 0x01, 0x00, 0x00, 0x00,
            0x0f, 0x84, ...XX4,
            0x8b, 0x74, 0x24, 0x10,
            0x53,
            //
            0x8a, XX, XX,
            0x8a, XX,
            0x80, XX, 0x20,
            0x80, XX, 0x5f,
            0x80, XX, 0x3b];
        addrX = L.findBytes(bytes2, L.processStartAddress, L.processStopAddress);
        isH = false;
    }
    if (!addrX) return false;
    addrX = L.findEnclosingAlignedFunction(addrX, 0x80);
    if (!addrX) return false;
    const hp = {
        address: addrX,
        type: L.NO_CONTEXT | L.USING_STRING,
        filter_fun(buffer) {
            // {しらがみ 白神}{きくり 菊理}が顔を紅潮させて怒った。
            let s = buffer.strA();
            s = L.re.sub(s, String.raw`\{(.*?) (.*?)\}`, '$2');
            s = L.re.sub(s, '[\r\n]+(\x81\x40)*');
            buffer.fromA(s);
        },
    };
    if (isH) {
        hp.text_fun = (context, hp, buffer, split) => {
            const u = context.stack[2] + 4; // TextUnionA *: text/chars at 0, size at 0x10, capacity at 0x14
            const size = L.u32(u + 0x10), capacity = L.u32(u + 0x14);
            buffer.from(capacity < 0x10 ? u : L.u32(u), size);
        };
    } else {
        hp.offset = L.stackoffset(2);
        hp.type |= L.DATA_INDIRECT;
    }
    return L.NewHook(hp, 'AYAKASHI');
}

const E = L.engine({
    name: 'ApRicoT',
    check: { FILE: 'arc.a*' },
    attach() { return InsertApRicoTHook(); },
});
const E2 = L.engine({
    name: 'ApRicoTlast', // a subclass of ApRicoT: the same attach_function
    check: { FILE: 'arc.dat' },
    certain: false,
    attach() { return InsertApRicoTHook(); },
});
const E3 = L.engine({
    name: 'ApRicoTOld',
    check: () => L.CheckFileAll(['adv.dat', 'bgm.dat', 'map.dat', 'minichara.dat', 'minigame.dat',
        'SCENARIO.dat', 'SE.dat', 'std.dat', 'system.dat', 'voice.dat']) ||
        L.CheckFileAll(['adv.dat', 'bgm.dat', 'field.dat', 'mini.dat', 'script.dat',
            'SE.dat', 'std.dat', 'system.dat', 'voice.dat']) ||
        L.CheckFileAll(['adv.dat', 'bgm.dat', 'script.dat', 'SE.dat', 'sec.dat', 'std.dat', 'system.dat', 'voice.dat']) ||
        L.CheckFileAll(['sec.dat', 'bgm.dat', 'script.dat', 'SE.dat', 'std.dat', 'system.dat', 'voice.dat',
            'adv/event.dat', 'adv/sprite.dat', 'adv/mask.dat', 'adv/effect.dat', 'adv/bg.dat']),
    attach() { return ApRicoTOldH() || ApRicoTOld2() || ayakashi(); },
});

module.exports = [E, E2, E3];
if (!module.parent) L.run([E, E2, E3]);
