import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const dist = path.join(root, 'dist');

function skipChrome(name) {
  return name === 'manifest.firefox.json' || name.endsWith('.md');
}
function skipFirefox(name) {
  return name === 'manifest.json' || name === 'manifest.firefox.json' || name.endsWith('.md');
}

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip(name)) continue;
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b, () => false);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(src, path.join(dist, 'chrome'), skipChrome);
copyDir(src, path.join(dist, 'firefox'), skipFirefox);
fs.copyFileSync(path.join(src, 'manifest.firefox.json'), path.join(dist, 'firefox', 'manifest.json'));

function zipDir(dir, out) {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dir });
}

const version = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
zipDir(path.join(dist, 'chrome'), path.join(dist, `tabmoor-chrome-${version}.zip`));
zipDir(path.join(dist, 'firefox'), path.join(dist, `tabmoor-firefox-${version}.zip`));
// Edge Add-ons uses the Chromium package.
fs.copyFileSync(
  path.join(dist, `tabmoor-chrome-${version}.zip`),
  path.join(dist, `tabmoor-edge-${version}.zip`),
);
console.log(`built dist/tabmoor-chrome-${version}.zip, tabmoor-firefox-${version}.zip, tabmoor-edge-${version}.zip`);
