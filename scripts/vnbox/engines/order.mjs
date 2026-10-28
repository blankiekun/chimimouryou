// node order.mjs: rewrites the engine list in PC_LunaEngines.js from LunaHook's check order
// (enginecollection32.cpp, commit be625f4, kept below) and the engine files in this folder.
// Run it after porting an engine: the automatic script then requires that file.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
// LunaHook's check_engines() order (class names; the file is <class>.js or exports that class).
export const ORDER = `LovaGame PPSSPPWindows VanillawareGC V8 cef Unity sakanagl PONScripter Patisserie Renpy Lightvn KiriKiri morning
utawarerumono SideB BGI Bootup shyakunage Eushully Majiro Elf Silkys SilkysOld CMVS Wolf Arcturus Circus Cotopha Artemis CatSystem
Atelier Atelier2 Tenco QLIE sakusesu Regista Pal Footy2 NeXAS LunaSoft Unicorn Unicorn_Anesen Rejet AdobeAir Retouch Malie Live
Nexton Lucifen Waffle TinkerBell TinkerBellold SystemAoi MBLMED NNNConfig Yuris Nitroplus Bruns XUSE EME RRE Candy WillowSoft AIL
ApRicoT Triangle2 Triangle AB2Try UnisonShift2 GameMaker DxLib CodeX _5pb_2 Minori RpgmXP littlecheese Eagls Debonosu C4 WillPlus
Tanuki GXP AOS Mink Mink2 YukaSystem2 Exp Syuntada Pensil Anim Nitroplus2 Reallive Siglus Taskforce2 RUGP IronGameSystem Anex86
ShinyDaysGame MarineHeart CaramelBox CaramelBoxMilkAji Escude Ryokucha Ryokucha2 Ryokuchaold Alice System4x Ages3ResT AXL Ciel
ACTGS Nijyuei Xbangbang UnknownEngine TSSystem Troy Tomato TerraLunar Tarte Bishop Bishop2 Sprite Speed FVP RUNE Purple Purple2
OVERDRIVE Ohgetsu HXP ONScripterru TriangleM SRPGStudio Overflow BKEngine Nitroplusplus Jellyfish SYSD LucaSystem ScrPlayer
ElfFunClubFinal Aksys Siglusold Willold WillPlusETERNAL GSX GASTRO akatombo ransel Silkyssakura splushwave Diskdream solfasys
FrontWing TamaokaSoft CisLugI mirage VALKYRIA CoffeeMaker Fizz CaramelBox2 TeethingRing lua51 A98SYS godot Erogos
Silkysveryveryold gazelle TEANAM TERIOS oldSystem40ini AdvPlayerHD DPM Escude_ignore Chartreux UnisonShift Interheart Abalone
Jisatu101 AGS hibiki Tanuki_last Abel _5pb ScenarioPlayer_last HorkEye Nexton1 ApRicoTlast Leaf Nekopack AdobeFlash10 Giga
FocasLens Tamamo jukujojidai Anisetta VitaminSoft Interlude Sakuradog Palette LCScript RPGMakerRGSS3 Reallive_old avg3216d ShinaRio
Suika2 KISS EntisGLS Furaiki DISCOVERY RPGMakerRGSS300 Sceplay Onscripter TACTICS RealliveX Stronger RPGMaker Aisystem6 AksysGames
AGE_System Cage Winters Aromarie Moonstone T2U antique BunBun DAC AbogadoPowers e_Erekiteru H_do_C Mink3 FrontWing2 RScript
TYPEMOON TAKUYO MixwillSoft MerRouge GROOVER SmartAdv ApRicoTOld Hug GJ Pinpai ADVSystem NUGSystem LizardFactory Nekotaro
PixelGameMakerMVplayer TamaSoft Broccoli Yatagarasu R11 For AniSeed MBSTRUTH Milk AZScript GLuer ZeroEscape ANOS PinkQuestion
InteractiveNovelEngine PiAS Seraphim Azurite ArcSystemWorks Monochrome ivory AZSystem RibbonMagic`.split(/\s+/);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !['libLuna.js', 'PC_LunaEngines.js'].includes(f)).sort();
    // each file's engine names: `name: '…'` inside L.engine({ … })
    const owner = new Map();
    for (const f of files) {
        for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/L\.engine\(\{\s*name:\s*'([^']+)'/g)) owner.set(m[1], f);
    }
    const missing = [...owner.keys()].filter((n) => !ORDER.includes(n));
    if (missing.length) throw new Error('engines not in LunaHook order: ' + missing.join(', '));
    const used = [...new Set(ORDER.filter((n) => owner.has(n)).map((n) => owner.get(n)))];
    const names = ORDER.filter((n) => owner.has(n));
    const block = [
        'const files = [',
        ...used.map((f) => `    require('./${f}'),`),
        '];',
        `const order = ${JSON.stringify(names)};`,
    ].join('\n');
    const target = path.join(dir, 'PC_LunaEngines.js');
    const text = fs.readFileSync(target, 'utf8').replace(/(\/\/ <engines>\n)[\s\S]*?(\/\/ <\/engines>)/, `$1${block}\n$2`);
    fs.writeFileSync(target, text);
    console.log(`PC_LunaEngines.js: ${owner.size} engines in ${used.length} files`);
}
