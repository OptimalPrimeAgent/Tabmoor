import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createFakeBrowser, rootDir } from './harness.mjs';

function b64url(bytes) { return Buffer.from(bytes).toString('base64url'); }
async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  async function sign(installId) {
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ c: 'abcd1234', i: installId, t: 'pro', iat: 1700000000 })));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(payload)));
    return payload + '.' + b64url(sig);
  }
  return { pub, sign };
}
function boot(fake, options) {
  options = options || {};
  const html = fs.readFileSync(path.join(rootDir, 'extension/popup.html'), 'utf8').replace(/<script src="[^"]+"><\/script>\s*/g, '');
  const dom = new JSDOM(html, { url: options.url || 'chrome-extension://tabmoor-test/popup.html?page=1', runScripts: 'dangerously' });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true });
  w.chrome = fake.api;
  for (const file of ['core.js', 'i18n.js', 'pro-key.js', 'unlock.js', 'popup.js']) {
    const script = w.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(rootDir, 'extension', file), 'utf8');
    w.document.body.appendChild(script);
  }
  return dom;
}
async function waitFor(fn) {
  for (let i = 0; i < 40; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error('timed out waiting for the popup');
}

test('free popup stays free, then a signed unlock code turns Pro on and release turns it off', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'da', intervalMin: 5, pro: false } });
  fake.state.windows = [{ id: 1, incognito: false, focused: true, state: 'normal', width: 800, height: 600, tabs: [{ id: 2, url: 'https://example.com/a', title: 'Eksempel', pinned: false, active: true, groupId: -1 }] }];
  fake.state.currentWindowId = 1;
  const dom = boot(fake);
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('[data-act="unlock"]'));
  const proText = doc.getElementById('proBox').textContent;
  assert.match(proText, /Køb Pro – 99 kr/);
  assert.match(proText, /ptd\.fullstack@gmail\.com/);
  assert.doesNotMatch(proText, /lemon/i);
  assert.equal(doc.getElementById('filters').hidden, true);
  doc.querySelector('[data-act="buy"]').click();
  assert.equal(fake.calls.filter(c => c.name === 'tabs.create').pop().detail.url, 'https://buy.stripe.com/fZu9AV0JDaBy6aG1v118c00');
  doc.getElementById('saveAll').click();
  await waitFor(() => doc.querySelector('[data-act="rename"]'));
  assert.equal(doc.querySelector('[data-act="folder"]'), null);
  doc.getElementById('tabBackups').click();
  await waitFor(() => /seneste 10/.test(doc.getElementById('keep').textContent));

  const keys = await testKey();
  dom.window.TABMOOR_PRO_KEY = { kid: 'test', jwk: { kty: 'OKP', crv: 'Ed25519', x: keys.pub.x } };
  const requests = [];
  dom.window.fetch = async (url, init) => {
    requests.push({ url, init });
    const body = JSON.parse(init.body);
    const token = await keys.sign(body.install_id);
    const payload = String(url).endsWith('/redeem')
      ? { token, installs_used: 1, installs_max: 3, customer_email: 'buyer@example.com' }
      : { ok: true, released: true, installs_used: 0, installs_max: 3 };
    return { status: 200, async text() { return JSON.stringify(payload); } };
  };
  doc.getElementById('tabSettings').click();
  doc.getElementById('unlockCode').value = 'tabm abcd efgh ijkl';
  doc.querySelector('[data-act="unlock"]').click();
  await waitFor(() => /Pro er aktiv på denne browser \(1 af 3\)/.test(doc.getElementById('proBox').textContent));
  assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(fake.local).includes('buyer@example.com'), false);
  assert.equal(await dom.window.TS.isPro(), true);
  doc.getElementById('tabSessions').click();
  await waitFor(() => doc.querySelector('[data-act="folder"]'));
  doc.getElementById('tabSettings').click();
  doc.querySelector('[data-act="deactivate"]').click();
  await waitFor(() => /Klik igen for at deaktivere/.test(doc.getElementById('proBox').textContent));
  doc.querySelector('[data-act="deactivate"]').click();
  await waitFor(() => doc.querySelector('[data-act="unlock"]'));
  assert.equal(requests[1].url.endsWith('/release'), true);
  assert.equal(fake.local.proUnlock, undefined);
  assert.equal(await dom.window.TS.isPro(), false);
  dom.window.close();
});

test('a Firefox popup does not call the unlock server before the tab is open', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'en', intervalMin: 5, pro: false } });
  const dom = boot(fake, { url: 'chrome-extension://tabmoor-test/popup.html' });
  Object.defineProperty(dom.window.navigator, 'userAgent', { get: () => 'Mozilla/5.0 Firefox/140.0', configurable: true });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('[data-act="unlock"]'));
  let called = 0;
  dom.window.fetch = async () => { called++; throw new Error('no'); };
  doc.getElementById('unlockCode').value = 'TABM-TEST-CODE-HERE';
  doc.querySelector('[data-act="unlock"]').click();
  await waitFor(() => fake.calls.some(c => c.name === 'tabs.create' && /pro=1/.test(c.detail.url)));
  assert.equal(called, 0);
  assert.equal(fake.sessionStore.unlockDraft, 'TABM-TEST-CODE-HERE');
  dom.window.close();
});

test('the tab copies a saved unlock code out of session storage', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'da', intervalMin: 5, pro: false } });
  await fake.api.storage.session.set({ unlockDraft: 'TABM-FROM-POPUP' });
  const dom = boot(fake, { url: 'chrome-extension://tabmoor-test/popup.html?page=1&pro=1' });
  await waitFor(() => dom.window.document.getElementById('unlockCode') && dom.window.document.getElementById('unlockCode').value === 'TABM-FROM-POPUP');
  assert.equal(fake.sessionStore.unlockDraft, undefined);
  dom.window.close();
});
