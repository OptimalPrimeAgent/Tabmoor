import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rootDir } from './harness.mjs';

const ext = path.join(rootDir, 'extension');

function read(name) {
  return fs.readFileSync(path.join(ext, name), 'utf8');
}

test('manifests are 0.3.0, optional Lemon host only, Firefox id unchanged', () => {
  const chrome = JSON.parse(read('manifest.json'));
  const firefox = JSON.parse(read('manifest.firefox.json'));
  assert.equal(chrome.version, '0.3.0');
  assert.equal(firefox.version, '0.3.0');
  assert.deepEqual(chrome.optional_host_permissions, ['https://api.lemonsqueezy.com/*']);
  assert.deepEqual(firefox.optional_host_permissions, ['https://api.lemonsqueezy.com/*']);
  assert.equal(chrome.host_permissions, undefined);
  assert.equal(firefox.host_permissions, undefined);
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.id, '{a476f9a3-31f4-4ef0-821a-3a3075f4a2f2}');
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, {
    required: ['none'],
    optional: ['authenticationInfo'],
  });
  assert.deepEqual(firefox.background.scripts, ['core.js', 'background.js']);
  assert.equal(chrome.background.service_worker, 'background.js');
});

test('network calls live only in the license module and never validate', () => {
  const quiet = ['core.js', 'background.js', 'popup.js', 'i18n.js', 'license-config.js'];
  for (const name of quiet) {
    const src = read(name);
    assert.doesNotMatch(src, /fetch\s*\(/);
    assert.doesNotMatch(src, /XMLHttpRequest/);
    assert.doesNotMatch(src, /WebSocket/);
    assert.doesNotMatch(src, /sendBeacon/);
  }
  const license = read('license.js');
  assert.match(license, /ACTIVATE_URL/);
  assert.match(license, /DEACTIVATE_URL/);
  assert.doesNotMatch(license, /licenses\/validate/);
  assert.doesNotMatch(license, /customer_email/);
  assert.doesNotMatch(license, /customer_name/);
  const config = read('license-config.js');
  assert.match(config, /https:\/\/api\.lemonsqueezy\.com\/v1\/licenses\/activate/);
  assert.match(config, /https:\/\/api\.lemonsqueezy\.com\/v1\/licenses\/deactivate/);
  assert.doesNotMatch(config, /licenses\/validate/);
  assert.match(config, /const LEMON_STORE_ID = 'LEMON_STORE_ID'/);
  assert.match(config, /const LEMON_PRODUCT_ID = 'LEMON_PRODUCT_ID'/);
  assert.match(config, /const LEMON_CHECKOUT_URL = ''/);
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
  assert.equal(manifest.browser_specific_settings.gecko.id, '{a476f9a3-31f4-4ef0-821a-3a3075f4a2f2}');
  assert.equal(fs.existsSync(path.join(tmp, 'manifest.firefox.json')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'store-listing-draft.md')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'license-config.js')), true);
});
