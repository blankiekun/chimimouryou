// sakusesu.js: LunaHook's sakusesu engine for VNBox (libLuna.js runs it).
// Ported from LunaTranslator (HIllya51), LunaHook/engine32/sakusesu.cpp and sakusesu.h, commit be625f4.
// SPDX-License-Identifier: GPL-3.0-or-later (ported from LunaTranslator (HIllya51))
'use strict';
const L = require('./libLuna.js');

const E = L.engine({
    name: 'sakusesu',
    // サクセス
    check: { FILE: 'SCRIPT/*.AFS' },
    certain: false,
    attach() {
        // if ((unsigned __int8)v1 >= 0x20u)
        //	{
        //	  if ((unsigned __int8)v1 >= 0x80u)
        //	  {
        //		if ((unsigned __int8)v1 >= 0xA0u)
        //		{
        //		  if ((unsigned __int8)v1 < 0xC0u)
        const bytesa0 = [0x3C, 0xA0, 0x73];
        const bytesc0 = [0x3C, 0xc0, 0x73];
        const bytes80 = [0x3C, 0x80, 0x73];
        let succ = false;
        for (const bs of [bytesa0, bytes80, bytesc0]) {
            let addr = L.findBytes(bs, L.processStartAddress, L.processStopAddress);
            if (!addr) continue;
            addr = L.findEnclosingAlignedFunction(addr);
            if (!addr) continue;
            succ = L.NewHook({ address: addr, offset: L.stackoffset(1), type: L.USING_STRING }, 'sakusesu') || succ;
            for (let xrefaddr of L.findxref_reverse(addr, addr - 0x10000, addr + 0x10000)) {
                xrefaddr = L.findEnclosingAlignedFunction(xrefaddr);
                if (xrefaddr === 0) continue;
                succ = L.NewHook({ address: xrefaddr, offset: L.stackoffset(1), type: L.USING_STRING }, 'sakusesu') || succ;
            }
        }
        return succ;
    },
});

module.exports = E;
if (!module.parent) L.run(E);
