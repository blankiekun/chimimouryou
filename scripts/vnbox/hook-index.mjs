// node hook-index.mjs <hooks dir>: writes <dir>/index.json, the dc00 PC scripts the Windows game
// dialog suggests from (hookSuggestion in apps/web/src/lib/data/windows-game.ts):
// [{ file, name (the script's @name, else its file name), exes (programs the script names) }].
import fs from 'node:fs';
import path from 'node:path';

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

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(scripts));
console.log(`Indexed ${scripts.length} hook scripts`);
