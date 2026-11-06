#!/usr/bin/env node
// Creates a new release: bumps the version everywhere, dates the changelog, commits and tags.
//   node scripts/release.mjs patch|minor|major   (or an exact version, e.g. 1.4.0)
// Then push it:  git push origin main && git push origin vX.Y.Z
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const arg = process.argv[2];
if (!arg) {
  console.error('Gebruik: node scripts/release.mjs patch|minor|major|<versie>');
  process.exit(1);
}
if (sh('git status --porcelain')) {
  console.error('Er staan nog niet-gecommitte wijzigingen. Commit die eerst.');
  process.exit(1);
}

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const writeJson = (f, data) => fs.writeFileSync(path.join(root, f), JSON.stringify(data, null, 2) + '\n');
const current = readJson('package.json').version ?? '0.0.0';
const [maj, min, pat] = current.split('.').map(Number);
const next =
  arg === 'major' ? `${maj + 1}.0.0` : arg === 'minor' ? `${maj}.${min + 1}.0` : arg === 'patch' ? `${maj}.${min}.${pat + 1}` : /^\d+\.\d+\.\d+$/.test(arg) ? arg : null;
if (!next) {
  console.error(`Onbekende versie: ${arg}`);
  process.exit(1);
}

for (const f of ['package.json', 'server/package.json', 'web/package.json']) {
  const j = readJson(f);
  j.version = next;
  writeJson(f, j);
}
for (const f of ['server/package-lock.json', 'web/package-lock.json']) {
  const j = readJson(f);
  j.version = next;
  if (j.packages?.['']) j.packages[''].version = next;
  writeJson(f, j);
}

// Move everything under "## [Unreleased]" into a dated section for this version.
const clPath = path.join(root, 'CHANGELOG.md');
const cl = fs.readFileSync(clPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const m = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/.exec(cl);
const notes = m?.[1].trim() ?? '';
if (!notes) {
  console.error('CHANGELOG.md: zet eerst de wijzigingen onder "## [Unreleased]".');
  process.exit(1);
}
fs.writeFileSync(clPath, cl.replace(/## \[Unreleased\]\n[\s\S]*?(?=\n## \[)/, `## [Unreleased]\n\n## [${next}] - ${today}\n\n${notes}\n`));

sh('git add -A');
execSync(`git commit -q -m "Release v${next}"`, { cwd: root, stdio: 'inherit' });
execSync(`git tag -a v${next} -m "Lumio v${next}"`, { cwd: root, stdio: 'inherit' });
console.log(`\nVersie ${current} → ${next} klaar. Publiceren:\n  git push origin main && git push origin v${next}`);
