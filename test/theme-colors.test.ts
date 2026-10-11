import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const contributed: { id: string; defaults: Record<string, string> }[] = pkg.contributes.colors;
const themes = ['codestudio-dark-color-theme.json', 'codestudio-light-color-theme.json'].map(f => JSON.parse(readFileSync(path.join(ROOT, 'themes', f), 'utf8')));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('theme colors', () => {
  it('every color used in code is contributed in package.json', () => {
    const ids = new Set(contributed.map(c => c.id));
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/color\('(\w+)'\)/g)) assert.ok(ids.has(`codestudio.${m[1]}`), `${path.basename(file)} uses codestudio.${m[1]}`);
    }
  });

  it('every contributed color has defaults for all theme kinds', () => {
    for (const c of contributed) {
      for (const kind of ['dark', 'light', 'highContrast', 'highContrastLight']) assert.ok(c.defaults[kind], `${c.id} ${kind}`);
    }
  });

  it('both CodeXStudio themes define every contributed color', () => {
    for (const t of themes) for (const c of contributed) assert.match(t.colors[c.id] ?? '', /^#[0-9A-Fa-f]{6,8}$/, `${t.name}: ${c.id}`);
  });
});
