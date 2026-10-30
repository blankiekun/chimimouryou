// node hook-index.mjs <hooks dir>: writes <dir>/index.json, the scripts the Windows game dialog
// suggests from (hookSuggestion in apps/web/src/lib/data/vn/windows-game.ts):
// [{ file, name (the script's @name, else its file name), exes (programs the script names),
//    luna? (LunaHook engine ports in engines/: [{ order, all?, any? }], the file checks the page can run) }].
import fs from 'node:fs';
import path from 'node:path';
import { ORDER } from './engines/order.mjs';

const dir = process.argv[2];
const scripts = fs
  .readdirSync(dir)
  .filter((file) => /^PC_.*\.js$/.test(file))
  .sort()
  .map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const name =
      text.match(/^\/\/\s*@name\s+(.+)$/m)?.[1].trim() ||
      file.replace(/^PC_|\.js$/g, '').replace(/_/g, ' ');
    const exes = [...new Set(text.match(/[\w.\-぀-ヿ一-鿿]+\.exe\b/gi) ?? [])];

    return { file, name, exes };
  });

// The engine files export L.engine({ name, check, … }) objects; loading them runs no hook.
const engineDir = path.join(dir, 'engines');
const cache = new Map();
function load(file) {
  const full = path.resolve(engineDir, file);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {}, parent: {}, id: full };
  cache.set(full, module);
  const source = fs.readFileSync(full, 'utf8');
  new Function('require', 'module', 'exports', source)(
    (name) => load(name),
    module,
    module.exports
  );
  return module.exports;
}
const fileChecks = (check) =>
  check && typeof check === 'object'
    ? 'FILE' in check
      ? { any: [check.FILE] }
      : 'FILE_ALL' in check
        ? { all: check.FILE_ALL }
        : 'FILE_ANY' in check
          ? { any: check.FILE_ANY }
          : {}
    : {};
let engines = 0;
if (fs.existsSync(engineDir)) {
  for (const file of fs
    .readdirSync(engineDir)
    .filter((f) => f.endsWith('.js') && f !== 'libLuna.js')
    .sort()) {
    const exported = [].concat(load(file));
    if (file === 'PC_LunaEngines.js') {
      scripts.push({ file: `engines/${file}`, name: 'LunaHook engines (automatic)', exes: [] });
      continue;
    }
    const luna = exported.map((engine) => ({
      order: ORDER.indexOf(engine.name),
      // a custom check (a function) names the files that pass it alone in `files`
      ...(engine.files ? { any: engine.files } : fileChecks(engine.check))
    }));
    engines += luna.length;
    scripts.push({
      file: `engines/${file}`,
      name: `${exported.map((engine) => engine.name).join(' / ')} (LunaHook engine)`,
      exes: [],
      luna
    });
  }
}

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(scripts));
console.log(`Indexed ${scripts.length} hook scripts (${engines} LunaHook engines)`);
