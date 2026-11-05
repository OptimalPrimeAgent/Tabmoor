import assert from 'node:assert/strict';
import test from 'node:test';
import { callsNamed, createFakeBrowser, loadTabmoor, win } from './harness.mjs';

const CONFIGURED = {
  STORE_ID: '11',
  PRODUCT_ID: '22',
  CHECKOUT_URL: '',
  ORIGIN: 'https://api.lemonsqueezy.com/*',
  ACTIVATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/activate',
  DEACTIVATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/deactivate',
};

function okBody(over) {
  return Object.assign({
    activated: true,
    error: null,
    license_key: { id: 1, status: 'active', key: 'KEY-1' },
    instance: { id: 'inst-1', name: 'Tabmoor on Chrome' },
    meta: {
      store_id: 11,
      product_id: 22,
      customer_id: 6,
      customer_name: 'Pat Example',
      customer_email: 'buyer@example.com',
    },
  }, over || {});
}

function mockFetch(handler) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const res = await handler(url, init, requests.length);
    return {
      status: res.status,
      async text() { return JSON.stringify(res.body); },
    };
  };
  return { fetch, requests };
}

function ctx() {
  const fake = createFakeBrowser();
  const loaded = loadTabmoor(fake);
  return { fake, TS: loaded.TS, TSLicense: loaded.TSLicense };
}

function posted(requests, index) {
  return new URLSearchParams(requests[index].init.body);
}

test('placeholders are still unset and checkout URL is empty', async () => {
  const { TSLicense } = ctx();
  assert.equal(TSLicense.configured(), false);
  assert.equal(TSLicense.checkoutUrl(), '');
  assert.equal(TSLicense.checkoutUrl({ CHECKOUT_URL: 'http://lemonsqueezy.com/buy' }), '');
  assert.equal(TSLicense.checkoutUrl({ CHECKOUT_URL: 'javascript:alert(1)' }), '');
  const { fetch, requests } = mockFetch(async () => ({ status: 200, body: okBody() }));
  const res = await TSLicense.activate('KEY-1', { fetch, config: undefined });
  assert.equal(res.reason, 'config');
  assert.equal(requests.length, 0);
  assert.equal(res.ok, false);
});

test('activate stores only key, instance id and time, and works offline afterwards', async () => {
  const { fake, TS, TSLicense } = ctx();
  const { fetch, requests } = mockFetch(async () => ({ status: 200, body: okBody() }));
  const res = await TSLicense.activate('  KEY-1 \n', {
    fetch,
    config: CONFIGURED,
    now: 1700000000000,
    userAgent: 'Mozilla/5.0 Chrome/156.0.0.0',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(res).sort(), ['ok']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, CONFIGURED.ACTIVATE_URL);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(requests[0].init.referrerPolicy, 'no-referrer');
  const body = posted(requests, 0);
  assert.equal(body.get('license_key'), 'KEY-1');
  assert.equal(body.get('instance_name'), 'Tabmoor on Chrome');
  assert.equal([...body.keys()].sort().join(), 'instance_name,license_key');
  const perm = callsNamed(fake, 'permissions.request')[0].detail;
  assert.deepEqual(perm.origins, ['https://api.lemonsqueezy.com/*']);
  assert.equal(perm.data_collection, undefined);

  const license = fake.local.license;
  assert.deepEqual(license, { key: 'KEY-1', instanceId: 'inst-1', activatedAt: 1700000000000 });
  assert.equal((await TS.getSettings()).pro, true);
  const dumped = JSON.stringify(fake.local);
  assert.equal(dumped.includes('buyer@example.com'), false);
  assert.equal(dumped.includes('Pat Example'), false);
  assert.equal(dumped.includes('customer_id'), false);

  await TS.addBackup(win('https://example.com/after'), 'auto');
  assert.equal(requests.length, 1);
});

test('instance name is the browser family and nothing else', () => {
  const { TSLicense } = ctx();
  assert.equal(TSLicense.instanceName('Mozilla/5.0 Firefox/140.0'), 'Tabmoor on Firefox');
  assert.equal(TSLicense.instanceName('Mozilla/5.0 Chrome/156.0.0.0 Edg/156.0.0.0'), 'Tabmoor on Edge');
  assert.equal(TSLicense.instanceName('Mozilla/5.0 Chrome/156.0.0.0'), 'Tabmoor on Chrome');
  const req = TSLicense.permissionRequest(CONFIGURED, 'Mozilla/5.0 Firefox/140.0');
  assert.deepEqual([...(req.data_collection || [])], ['authenticationInfo']);
  assert.equal(TSLicense.permissionRequest(CONFIGURED, 'Chrome').data_collection, undefined);
});

test('pick drops customer fields immediately', () => {
  const { TSLicense } = ctx();
  const picked = TSLicense.pick(okBody());
  assert.equal(JSON.stringify(picked).includes('buyer@example.com'), false);
  assert.equal(JSON.stringify(picked).includes('Pat Example'), false);
  assert.equal(picked.storeId, 11);
  assert.equal(picked.instanceId, 'inst-1');
});

test('a key for another product is deactivated and not stored', async () => {
  const { fake, TS, TSLicense } = ctx();
  const { fetch, requests } = mockFetch(async (url) => {
    if (url.endsWith('/activate')) return { status: 200, body: okBody({ meta: { store_id: 99, product_id: 22, customer_email: 'buyer@example.com', customer_name: 'Pat Example' } }) };
    return { status: 200, body: { deactivated: true, error: null, meta: { customer_email: 'buyer@example.com' } } };
  });
  const res = await TSLicense.activate('KEY-1', { fetch, config: CONFIGURED });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'product');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, CONFIGURED.DEACTIVATE_URL);
  assert.equal(posted(requests, 1).get('instance_id'), 'inst-1');
  assert.equal((await TS.getSettings()).pro, false);
  assert.equal(fake.local.license, undefined);
  assert.equal(JSON.stringify(fake.local).includes('buyer@example.com'), false);
});

test('network failure, permission denial and an invalid key do not unlock Pro', async () => {
  const denied = ctx();
  denied.fake.state.denyPermission = true;
  const deniedFetch = mockFetch(async () => ({ status: 200, body: okBody() }));
  const d = await denied.TSLicense.activate('KEY-1', { fetch: deniedFetch.fetch, config: CONFIGURED });
  assert.equal(d.reason, 'permission');
  assert.equal(deniedFetch.requests.length, 0);
  assert.equal((await denied.TS.getSettings()).pro, false);

  const down = ctx();
  const net = await down.TSLicense.activate('KEY-1', {
    fetch: async () => { throw new Error('offline'); },
    config: CONFIGURED,
  });
  assert.equal(net.reason, 'network');
  assert.equal((await down.TS.getSettings()).pro, false);

  const bad = ctx();
  const { fetch } = mockFetch(async () => ({ status: 400, body: { activated: false, error: 'license_key is invalid' } }));
  const b = await bad.TSLicense.activate('nope', { fetch, config: CONFIGURED });
  assert.equal(b.reason, 'invalid');
  assert.equal(bad.fake.local.license, undefined);
});

test('deactivate frees the slot, clears Pro and trims backups to the free limit', async () => {
  const { fake, TS, TSLicense } = ctx();
  const { fetch, requests } = mockFetch(async (url) => {
    if (url.endsWith('/activate')) return { status: 200, body: okBody() };
    return { status: 200, body: { deactivated: true, error: null, meta: { customer_email: 'buyer@example.com', customer_name: 'Pat Example' } } };
  });
  await TSLicense.activate('KEY-1', { fetch, config: CONFIGURED, now: 5 });
  for (let i = 0; i < 15; i++) await TS.addBackup(win('https://example.com/n' + i), 'auto');
  assert.equal((await TS.listBackups()).length, 15);
  const res = await TSLicense.deactivate({ fetch, config: CONFIGURED, knownLicense: { key: 'KEY-1', instanceId: 'inst-1' } });
  assert.equal(res.ok, true);
  assert.equal(requests.at(-1).url, CONFIGURED.DEACTIVATE_URL);
  assert.equal((await TS.getSettings()).pro, false);
  assert.equal(fake.local.license, undefined);
  assert.equal((await TS.listBackups()).length, 10);
  assert.equal(JSON.stringify(fake.local).includes('buyer@example.com'), false);
});

test('a failed deactivate leaves Pro in place', async () => {
  const { fake, TS, TSLicense } = ctx();
  await fake.api.storage.local.set({
    settings: { lang: 'auto', intervalMin: 5, pro: true },
    license: { key: 'KEY-1', instanceId: 'inst-1', activatedAt: 5 },
  });
  const net = await TSLicense.deactivate({
    fetch: async () => { throw new Error('offline'); },
    config: CONFIGURED,
    knownLicense: { key: 'KEY-1', instanceId: 'inst-1' },
  });
  assert.equal(net.reason, 'network');
  assert.equal((await TS.getSettings()).pro, true);
  assert.equal(fake.local.license.key, 'KEY-1');

  fake.state.denyPermission = true;
  const denied = await TSLicense.deactivate({
    fetch: async () => { throw new Error('should not be called'); },
    config: CONFIGURED,
    knownLicense: { key: 'KEY-1', instanceId: 'inst-1' },
  });
  assert.equal(denied.reason, 'permission');
  assert.equal((await TS.getSettings()).pro, true);
});

test('an already removed instance still clears the local license', async () => {
  const { fake, TS, TSLicense } = ctx();
  await fake.api.storage.local.set({
    settings: { pro: true, lang: 'auto', intervalMin: 5 },
    license: { key: 'KEY-1', instanceId: 'inst-1', activatedAt: 5 },
  });
  const res = await TSLicense.deactivate({
    fetch: async () => ({ status: 404, async text() { return JSON.stringify({ deactivated: false, error: 'instance not found' }); } }),
    config: CONFIGURED,
    knownLicense: { key: 'KEY-1', instanceId: 'inst-1' },
  });
  assert.equal(res.ok, true);
  assert.equal(fake.local.license, undefined);
  assert.equal((await TS.getSettings()).pro, false);
});

test('deactivating without a stored key clears a manual Pro flag and does not call the network', async () => {
  const { TS, TSLicense } = ctx();
  await TS.setSettings({ pro: true });
  let called = 0;
  const res = await TSLicense.deactivate({
    fetch: async () => { called++; throw new Error('no'); },
    config: CONFIGURED,
    knownLicense: null,
  });
  assert.equal(res.localOnly, true);
  assert.equal(called, 0);
  assert.equal((await TS.getSettings()).pro, false);
});
