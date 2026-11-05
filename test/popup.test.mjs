import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createFakeBrowser, rootDir } from './harness.mjs';

function boot(fake, options) {
  options = options || {};
  const html = fs.readFileSync(path.join(rootDir, 'extension/popup.html'), 'utf8')
    .replace(/<script src="[^"]+"><\/script>\s*/g, '');
  const dom = new JSDOM(html, {
    url: options.url || 'chrome-extension://tabmoor-test/popup.html?page=1',
    runScripts: 'dangerously',
  });
  const w = dom.window;
  w.chrome = fake.api;
  for (const file of ['core.js', 'i18n.js', 'license-config.js', 'license.js', 'popup.js']) {
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

test('free popup stays free, then a mocked activation unlocks Pro and deactivate locks it again', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'da', intervalMin: 5, pro: false } });
  fake.state.windows = [{
    id: 1, incognito: false, focused: true, state: 'normal', width: 800, height: 600,
    tabs: [{ id: 2, url: 'https://example.com/a', title: 'Eksempel', pinned: false, active: true, groupId: -1 }],
  }];
  fake.state.currentWindowId = 1;
  const dom = boot(fake);
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('[data-act="activate"]'));

  const proText = doc.getElementById('proBox').textContent;
  assert.match(proText, /Aktivér/);
  assert.match(proText, /99 kr\./);
  assert.match(proText, /Købslinket sættes ind/);
  assert.match(proText, /1 backup pr\. dag i 30 dage/);
  assert.doesNotMatch(proText, /kommer snart/);
  assert.equal(doc.getElementById('filters').hidden, true);
  assert.equal(doc.querySelector('a[href]'), null);

  doc.getElementById('saveAll').click();
  await waitFor(() => doc.querySelector('[data-act="rename"]'));
  assert.equal(doc.querySelector('[data-act="folder"]'), null);
  assert.equal(doc.querySelector('[data-act="tags"]'), null);
  assert.equal((await fake.api.storage.local.get('sessions')).sessions.length, 1);

  doc.getElementById('tabBackups').click();
  await waitFor(() => /seneste 10/.test(doc.getElementById('keep').textContent));

  const requests = [];
  dom.window.TABMOOR_LEMON = Object.assign({}, dom.window.TABMOOR_LEMON, {
    STORE_ID: '11',
    PRODUCT_ID: '22',
  });
  dom.window.fetch = async (url, init) => {
    requests.push({ url, init });
    const activate = String(url).endsWith('/activate');
    const body = activate
      ? {
        activated: true,
        error: null,
        license_key: { status: 'active' },
        instance: { id: 'inst-9' },
        meta: { store_id: 11, product_id: 22, customer_name: 'Pat Example', customer_email: 'buyer@example.com' },
      }
      : { deactivated: true, error: null, meta: { customer_email: 'buyer@example.com', customer_name: 'Pat Example' } };
    return { status: 200, async text() { return JSON.stringify(body); } };
  };

  doc.getElementById('tabSettings').click();
  const input = doc.getElementById('licenseKey');
  input.value = 'KEY-9';
  doc.querySelector('[data-act="activate"]').click();
  await waitFor(() => /Pro er aktiv/.test(doc.getElementById('proBox').textContent) && doc.getElementById('filters').hidden === false);
  assert.equal(requests.length, 1);
  assert.equal(new URLSearchParams(requests[0].init.body).get('instance_name'), 'Tabmoor on Chrome');
  assert.equal(JSON.stringify(fake.local).includes('buyer@example.com'), false);
  assert.equal(doc.body.textContent.includes('buyer@example.com'), false);
  assert.equal(fake.local.license.instanceId, 'inst-9');
  assert.equal(doc.getElementById('filters').hidden, false);

  doc.getElementById('tabSessions').click();
  await waitFor(() => doc.querySelector('[data-act="folder"]'));
  assert.ok(doc.querySelector('[data-act="tags"]'));

  doc.getElementById('tabSettings').click();
  doc.querySelector('[data-act="deactivate"]').click();
  await waitFor(() => /Klik igen for at deaktivere/.test(doc.getElementById('proBox').textContent));
  doc.querySelector('[data-act="deactivate"]').click();
  await waitFor(() => doc.querySelector('[data-act="activate"]'));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.endsWith('/deactivate'), true);
  assert.equal(fake.local.license, undefined);
  assert.equal((await dom.window.TS.getSettings()).pro, false);
  assert.equal(doc.body.textContent.includes('buyer@example.com'), false);
  dom.window.close();
});

test('the tab takes the draft key out of session storage', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'da', intervalMin: 5, pro: false } });
  await fake.api.storage.session.set({ licenseDraft: 'KEY-TAB' });
  const dom = boot(fake, { url: 'chrome-extension://tabmoor-test/popup.html?page=1&pro=1' });
  const doc = dom.window.document;
  await waitFor(() => doc.getElementById('licenseKey') && doc.getElementById('licenseKey').value === 'KEY-TAB');
  assert.equal(fake.sessionStore.licenseDraft, undefined);
  assert.match(doc.getElementById('proBox').textContent, /Klik Aktivér igen/);
  dom.window.close();
});

test('the popup itself does not call Lemon, because the permission dialog would close it', async () => {
  const fake = createFakeBrowser();
  await fake.api.storage.local.set({ settings: { lang: 'en', intervalMin: 5, pro: false } });
  const dom = boot(fake, { url: 'chrome-extension://tabmoor-test/popup.html' });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('[data-act="activate"]'));
  let called = 0;
  dom.window.fetch = async () => { called++; throw new Error('no network from the popup'); };
  doc.getElementById('licenseKey').value = 'KEY-POPUP';
  doc.querySelector('[data-act="activate"]').click();
  await waitFor(() => fake.calls.some(c => c.name === 'tabs.create'));
  assert.equal(called, 0);
  const opened = fake.calls.filter(c => c.name === 'tabs.create').pop().detail;
  assert.match(opened.url, /popup\.html\?page=1&pro=1/);
  assert.equal(fake.sessionStore.licenseDraft, 'KEY-POPUP');
  dom.window.close();
});
