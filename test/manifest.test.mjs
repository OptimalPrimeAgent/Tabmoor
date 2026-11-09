import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rootDir } from './harness.mjs';

const ext = path.join(rootDir, 'extension');
const read = name => fs.readFileSync(path.join(ext, name), 'utf8');

test('manifests are 0.3.0 with no host permission and Chrome 113 for Ed25519', () => {
  const chrome = JSON.parse(read('manifest.json'));
  const firefox = JSON.parse(read('manifest.firefox.json'));
  assert.equal(chrome.version, '0.3.0');
  assert.equal(firefox.version, '0.3.0');
  assert.equal(chrome.minimum_chrome_version, '113');
  assert.equal(chrome.host_permissions, undefined);
  assert.equal(chrome.optional_host_permissions, undefined);
  assert.equal(firefox.host_permissions, undefined);
  assert.equal(firefox.optional_host_permissions, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.id, '{a476f9a3-31f4-4ef0-821a-3a3075f4a2f2}');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'], optional: ['authenticationInfo'] });
  assert.deepEqual(firefox.background.scripts, ['core.js', 'pro-key.js', 'unlock.js', 'background.js']);
  assert.deepEqual(chrome.permissions, ['tabs', 'tabGroups', 'storage', 'unlimitedStorage', 'alarms']);
});

test('network calls are only redeem and release, with no Lemon Squeezy left', () => {
  for (const name of fs.readdirSync(ext)) {
    if (!/\.(js|html|json|md)$/.test(name)) continue;
    const src = read(name);
    assert.doesNotMatch(src, /lemon/i, name);
    assert.doesNotMatch(src, /thamsdimon/i, name);
  }
  for (const name of ['core.js', 'background.js', 'popup.js', 'i18n.js', 'pro-key.js']) {
    assert.doesNotMatch(read(name), /fetch\s*\(/, name);
  }
  assert.match(read('unlock.js'), /mode: 'cors'/);
  assert.match(read('pro-key.js'), /https:\/\/tabmoor-unlock\.tabmoor\.workers\.dev\/redeem/);
  assert.match(read('pro-key.js'), /https:\/\/tabmoor-unlock\.tabmoor\.workers\.dev\/release/);
  assert.match(read('pro-key.js'), /https:\/\/buy\.stripe\.com\/fZu9AV0JDaBy6aG1v118c00/);
});

test('build emits chrome, firefox and edge packages without the listing draft', () => {
  execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'build.mjs')], { cwd: rootDir });
  const dist = path.join(rootDir, 'dist');
  for (const name of ['tabmoor-chrome-0.3.0.zip', 'tabmoor-firefox-0.3.0.zip', 'tabmoor-edge-0.3.0.zip']) {
    assert.equal(fs.existsSync(path.join(dist, name)), true);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabmoor-zip-'));
  execFileSync('unzip', ['-q', path.join(dist, 'tabmoor-firefox-0.3.0.zip'), '-d', tmp]);
  const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.0');
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(fs.existsSync(path.join(tmp, 'unlock.js')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'license.js')), false);
});
