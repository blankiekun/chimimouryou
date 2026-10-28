// NeXAS.js: LunaHook's NeXAS engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/NeXAS.cpp and NeXAS.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');
const { XX, XX4 } = L;

/** jichi 7/6/2014 NeXAS
 *  Sample game: BALDRSKYZERO EXTREME
 *
 *  Call graph:
 *  - GetGlyphOutlineA x 2 functions
 *  - Caller 503620: char = [arg1 + 0x1a8]
 *  - Caller: 500039, 4ffff0
 *    edi = [esi+0x1a0] # stack size 4x3
 *    arg1 = eax = [edi]
 */
function InsertNeXASHookA() {
    // There are two GetGlyphOutlineA, both of which seem to have the same texts
    const addr = L.findCallAddress(L.FindFunction('GetGlyphOutlineA'), L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    const sig = [
        // if ( *(_DWORD *)(v1 + 288) < 0x10u ) v9 = v1 + 268; else v9 = *(v1 + 268);
        // uChara = _mbsnextc(v9); GlyphOutlineA = GetGlyphOutlineA(DC, uChara, 6u, &gm, 0, 0, &mat2);
        0x83, 0x7E, 0x18, 0x10,
        0x72, 0x05,
        0x8B, 0x76, 0x04,
        0xEB, 0x03,
        0x83, 0xC6, 0x04,
        0x56,
        0xE8, ...XX4];
    let addr2 = L.reverseFindBytes(sig, addr - 0x40, addr);
    if (addr2) {
        addr2 = L.findEnclosingAlignedFunction(addr2);
        if (addr2) {
            const hp = {
                address: addr2,
                text_fun(context, hp, buffer, split) {
                    const v1 = context.ecx;
                    let v9;
                    if (L.u32(v1 + 288) < 0x10)
                        v9 = v1 + 268;
                    else
                        v9 = L.u32(v1 + 268);

                    buffer.fromCharPtr(v9);
                },
            };
            if (L.NewHook(hp, 'NeXAS_1'))
                return true;
        }
    }

    // BALDR HEART
    const sig2 = [
        0x72, 0x02,
        0x8b, 0x00,
        0x50,
        0x8d, 0x8d, 0x00, 0xfc, 0xff, 0xff,
        0x68, 0x00, 0x04, 0x00, 0x00,
        0x51,
        0xe8, ...XX4];
    const addrx = L.findBytes(sig2, L.processStartAddress, L.processStopAddress);
    if (addrx) {
        const hp = {
            address: addrx + sig2.length - 5,
            offset: L.regoffset('eax'),
            type: L.USING_STRING,
            lineSeparator: '@n',
            filter_fun(buffer) {
                let s = buffer.strA();
                s = L.re.sub(s, '@r(.*?)@(.*?)@', '$1');
                s = L.re.sub(s, String.raw`@v\d{8}`);
                s = L.strReplace(s, '@k');
                s = L.strReplace(s, '@g');
                s = L.strReplace(s, '@d');
                buffer.fromA(s);
            },
        };
        if (L.NewHook(hp, 'NeXAS3'))
            return true;
    }

    // hp.address = (DWORD)::GetGlyphOutlineA;
    return L.NewHook({
        address: addr,
        type: L.CODEC_ANSI_BE | L.NO_CONTEXT,
        offset: L.stackoffset(1),
        // Either lpgm or lpmat2 are good choices for a split; the C++ leaves it out (it also splits a click-to-skip sentence).
    }, 'NeXAS');
}

function InsertNeXASHookW() {
    //[240926][1287246][エンターグラム] 制服カノジョ まよいごエンゲージ DL版 (files)
    // char sig[] = "Gaiji%s%02d%02d.fil";或者也可以找所有的push这个的地址
    const addrs = L.findiatcallormov_all(L.FindFunction('GetGlyphOutlineW'), L.processStartAddress, L.processStartAddress, L.processStopAddress, L.PAGE_EXECUTE);
    let succ = false;
    for (const addr1 of addrs) {
        const addr = L.findEnclosingAlignedFunction(addr1);
        if (!addr) continue;
        const check = [
            0x83, XX, ...XX4, 0x10, // cmp     dword ptr [edi+0BCh], 10h; XX4:0xbc, 0x00, 0x00, 0x00
            0x8d, XX, ...XX4,       // lea     edx, [edi+0A8h], XX4:0xa8, 0x00, 0x00, 0x00
            0x89, XX, XX,
            0x72, 0x06,
            0x8b, XX, ...XX4,       // mov     edx, [edi+0A8h], XX4:0xa8, 0x00, 0x00, 0x00
        ];
        const addrx = L.findBytes(check, addr, addr1);
        if (!addrx) continue;
        // nexassomeinfo { DWORD off1, off2, split; } as the hook's user_value
        const info = { off1: L.u32(addrx + 2), off2: L.u32(addrx + 9), split: 0 };
        const hp = {
            address: addr,
            type: L.USING_STRING | L.CODEC_UTF8, // utf8编码的单字符
            user_value: info,
            text_fun(context, hp, buffer, split) {
                // v18 = this + 168; if (!(*(this + 188) < 0x10)) v18 = *(this + 168); sub_42A120(v34, v18, *(this + 184)); //utf8转utf16
                const v1 = context.ecx;
                const off1 = info.off1; // 188,0xbc
                const off2 = info.off2; // 168,0xa8
                let v9;
                if (L.u32(v1 + off1) < 0x10)
                    v9 = v1 + off2;
                else
                    v9 = L.u32(v1 + off2);

                buffer.fromCharPtr(v9);
                if (info.split === 0)
                    info.split = context.stack[1];
                split.value = Math.abs(info.split - context.stack[1]) < 0x10 ? 1 : 0;
                // 文本会被分成两个线程，原因未知。人名线程是比文本小很多的，两个文本线程离得很近
                // 不能不分，不分会导致沾到一起。
            },
        };
        succ = L.NewHook(hp, 'NeXASW') || succ;
    }
    return succ;
}

function _2() {
    // 飛ぶ山羊はさかさまの木の夢を見るか
    const bs = [
        0x8B, 0x56, 0x68,
        0x8a, 0x04, 0x3a,
        0x8d, 0x0c, 0x3a,
        0x33, 0xdb,
        0x3c, 0x40];
    const addr = L.findBytes(bs, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    return L.NewHook({
        address: addr + 9,
        type: L.DATA_INDIRECT,
        index: 0,
        offset: L.regoffset('ecx'),
        filter_fun(buffer) {
            if (buffer.viewA()[0] === '@') {
                buffer.clear();
            }
        },
    }, 'NeXAS2');
}

function _3() {
    // 真剣で私に恋しなさい！Ａ－５
    const atv = L.aToBytes('@v\0');
    let aV = L.findBytes(atv, L.processStartAddress, L.processStopAddress);
    if (!aV) return false;
    aV = L.findBytes(atv, aV + 1, L.processStopAddress); // 第一个是历史，第二个才是当前文本
    if (!aV) return false;
    let addr = L.findPushAddress(aV, L.processStartAddress, L.processStopAddress);
    if (!addr) return false;
    addr = L.findEnclosingAlignedFunction(addr);
    if (!addr) return false;
    // 彼女はオレからはなれない
    // 这个地址不正确，跳过。
    if (L.u8(addr) === 0x10) return false;
    return L.NewHook({
        address: addr,
        type: L.USING_STRING,
        text_fun(context, hp, buffer, split) {
            // TextUnionA (util/textunion.h): chars[16] or text pointer at 0x0, size at 0x10, capacity at 0x14
            const a2 = context.stack[1]; // std::string*
            const size = L.u32(a2 + 0x10), capacity = L.u32(a2 + 0x14);
            buffer.from(capacity < 0x10 ? a2 : L.u32(a2), size);
        },
        filter_fun(buffer) {
            let s = buffer.strA();
            if (s.startsWith('@')) {
                if (s.startsWith('@v')) {
                    // S001_L1_0001
                    s = L.re.sub(s, '@([_v][a-zA-Z0-9]+)+');
                    buffer.fromA(s);
                } else {
                    buffer.clear();
                }
            }
        },
        lineSeparator: '@n',
    }, 'NeXAS4');
}

//[241219][1299663][エンターグラム] この青空に約束を― Refine
function b4() {
    const bs = [
        0x8b, 0x45, XX,
        0x3b, 0xd0,
        0x0f, 0x84, ...XX4,
        0x83, 0x78, 0x14, 0x0f,
        0x8b, 0x48, 0x10,
        0x76, 0x02,
        0x8b, 0x00];
    const aV = L.findBytes(bs, L.processStartAddress, L.processStopAddress);
    if (!aV) return false;
    return L.NewHook({
        address: aV + 3,
        type: L.USING_STRING | L.CODEC_UTF8 | L.NO_CONTEXT,
        text_fun(context, hp, buffer, split) {
            const a = context.eax; // TextUnionA
            const size = L.u32(a + 0x10), capacity = L.u32(a + 0x14);
            buffer.from(capacity < 0x10 ? a : L.u32(a), size);
        },
        filter_fun(buffer) {
            let s = buffer.strA();
            // 制服カノジョ2.5
            // 【古賀】@n@v09020004「あ、@*name@00@板橋@*@さんもこんな時間に。@k
            s = L.re.sub(s, String.raw`@\*name@\d+@(.*?)@\*@`, '$1');
            s = L.re.sub(s, '@([_v][a-zA-Z0-9]+)+');
            s = L.re.sub(s, String.raw`@t\d{4}`);
            s = L.re.sub(s, String.raw`@w\d{4}`);
            s = L.re.sub(s, String.raw`@s\d{4}`);
            s = L.re.sub(s, String.raw`@m\d{2}`);
            s = L.re.sub(s, String.raw`@f\d{2}`);
            s = L.re.sub(s, String.raw`@h[_\d\w]+`);
            s = L.re.sub(s, String.raw`@r(.*?)@(.*?)@`, '$1');
            s = L.strReplace(s, '@n');
            s = L.strReplace(s, '@e');
            s = L.strReplace(s, '@k');
            s = L.strReplace(s, '@p');
            buffer.fromA(s);
        },
    }, 'NeXAS5');
}

const E = L.engine({
    name: 'NeXAS',
    check: () => L.SearchResourceString('NeXAS') ||
        (L.CheckFile('*.pac') && L.CheckFileAny(['Thumbnail.pac', 'Thumbnail5.pac'])),
    certain: false,
    attach() {
        const _ = _2() || _3() || b4();
        return InsertNeXASHookA() || InsertNeXASHookW() || _;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
