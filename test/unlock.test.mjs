import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeBrowser, loadTabmoor, win } from './harness.mjs';

function setup() {
  const fake = createFakeBrowser();
  const ctx = loadTabmoor(fake, { unlock: true });
  ctx.fake = fake;
  return ctx;
}
function b64url(bytes) { return Buffer.from(bytes).toString('base64url'); }
async function signer() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  async function sign(installId, extra) {
    const payload = b64url(new TextEncoder().encode(JSON.stringify(Object.assign({ c: 'abcd1234', i: installId, t: 'pro', iat: 1700000000 }, extra || {}))));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(payload)));
    return payload + '.' + b64url(sig);
  }
  return { pub, sign };
}
function mockFetch(handler) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const res = await handler(url, init);
    return { status: res.status, async text() { return JSON.stringify(res.body); } };
  };
  return { fetch, requests };
}

test('the embedded public key is the published Tabmoor key', async () => {
  const ctx = setup();
  assert.equal(ctx.TABMOOR_PRO_KEY.kid, 'tabmoor-2026-11');
  assert.equal(ctx.TABMOOR_PRO_KEY.jwk.x, 'M82Nd380ykSa-Yya6OsaXvATK2iclWOvcoi2lHlf6-Q');
  assert.equal(ctx.TABMOOR_UNLOCK.BUY_URL, 'https://buy.stripe.com/fZu9AV0JDaBy6aG1v118c00');
  const imported = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: ctx.TABMOOR_PRO_KEY.jwk.x }, { name: 'Ed25519' }, false, ['verify']);
  assert.equal(imported.algorithm.name, 'Ed25519');
});

test('install id is created once and matches the worker pattern', async () => {
  const { TSUnlock } = setup();
  const a = await TSUnlock.getInstallId();
  assert.equal(a, await TSUnlock.getInstallId());
  assert.match(a, TSUnlock.INSTALL_RE);
});

test('a valid token unlocks offline and a bad signature or other install does not', async () => {
  const ctx = setup();
  const { pub, sign } = await signer();
  ctx.TABMOOR_PRO_KEY.jwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x };
  const installId = await ctx.TSUnlock.getInstallId();
  const token = await sign(installId);
  assert.equal((await ctx.TSUnlock.verifyToken(token, installId)).ok, true);
  assert.equal((await ctx.TSUnlock.verifyToken(token, 'other-install-id')).ok, false);
  assert.equal((await ctx.TSUnlock.verifyToken(await sign(installId, { t: 'free' }), installId)).ok, false);
  await ctx.fake.api.storage.local.set({ settings: { pro: true, lang: 'auto', intervalMin: 5 }, proUnlock: { code: 'x', token: token.slice(0, -2) + 'aa' } });
  assert.equal(await ctx.TS.isPro(), false);
  await ctx.fake.api.storage.local.set({ proUnlock: { code: 'TABM-TEST', token, installsUsed: 1, installsMax: 3 } });
  assert.equal(await ctx.TS.isPro(), true);
  assert.equal((await ctx.TS.limits()).backups, 50);
  const dumped = JSON.stringify(await ctx.TS.exportData());
  assert.equal(dumped.includes(token), false);
  assert.equal(dumped.includes(installId), false);
});

test('redeem stores code and token only after the signature checks out', async () => {
  const ctx = setup();
  const { pub, sign } = await signer();
  ctx.TABMOOR_PRO_KEY.jwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x };
  const { fetch, requests } = mockFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    return { status: 200, body: { token: await sign(body.install_id), installs_used: 1, installs_max: 3, customer_email: 'buyer@example.com' } };
  });
  const res = await ctx.TSUnlock.redeem('  tabm test code  ', { fetch });
  assert.equal(res.ok, true);
  assert.equal(requests[0].url, ctx.TABMOOR_UNLOCK.REDEEM_URL);
  assert.equal(requests[0].init.mode, 'cors');
  const sent = JSON.parse(requests[0].init.body);
  assert.deepEqual(Object.keys(sent).sort(), ['code', 'install_id']);
  assert.equal(ctx.fake.local.proUnlock.code, 'tabm test code');
  assert.equal(ctx.fake.local.proUnlock.installsUsed, 1);
  assert.equal(JSON.stringify(ctx.fake.local).includes('buyer@example.com'), false);
  await ctx.TS.addBackup(win('https://example.com/after'), 'auto');
  assert.equal(requests.length, 1);
});

test('redeem maps each worker error and does not unlock', async () => {
  const cases = [
    [{ status: 404, body: { error: 'invalid_code' } }, 'invalid_code'],
    [{ status: 403, body: { error: 'limit_reached', installs_used: 3, installs_max: 3 } }, 'limit_reached'],
    [{ status: 400, body: { error: 'bad_install_id' } }, 'bad_install_id'],
    [{ status: 400, body: { error: 'bad_request' } }, 'bad_request'],
    [{ status: 429, body: { error: 'rate_limited' } }, 'rate_limited'],
    [{ status: 403, body: { error: 'revoked' } }, 'revoked'],
  ];
  for (const [response, reason] of cases) {
    const ctx = setup();
    const { fetch } = mockFetch(async () => response);
    const res = await ctx.TSUnlock.redeem('TABM-1234', { fetch });
    assert.equal(res.reason, reason);
    assert.equal(ctx.fake.local.proUnlock, undefined);
    assert.equal((await ctx.TS.getSettings()).pro, false);
  }
  const empty = setup();
  let called = 0;
  assert.equal((await empty.TSUnlock.redeem('   ', { fetch: async () => { called++; throw new Error('no'); } })).reason, 'empty');
  assert.equal(called, 0);
});

test('a 200 response with a bad signature is not stored', async () => {
  const ctx = setup();
  const res = await ctx.TSUnlock.redeem('TABM-NOPE', { fetch: async () => ({ status: 200, async text() { return JSON.stringify({ token: 'aaaa.bbbb', installs_used: 1, installs_max: 3 }); } }) });
  assert.equal(res.reason, 'token');
  assert.equal(ctx.fake.local.proUnlock, undefined);
});

test('release frees the slot, clears Pro and trims backups', async () => {
  const ctx = setup();
  const { pub, sign } = await signer();
  ctx.TABMOOR_PRO_KEY.jwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x };
  const installId = await ctx.TSUnlock.getInstallId();
  await ctx.fake.api.storage.local.set({ settings: { lang: 'auto', intervalMin: 5, pro: true }, proUnlock: { code: 'TABM-KEEP', token: await sign(installId), installsUsed: 2, installsMax: 3 } });
  for (let i = 0; i < 12; i++) await ctx.TS.addBackup(win('https://example.com/r' + i), 'auto');
  const { fetch, requests } = mockFetch(async () => ({ status: 200, body: { ok: true, released: true, installs_used: 1, installs_max: 3, customer_email: 'buyer@example.com' } }));
  const res = await ctx.TSUnlock.release({ fetch });
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(requests[0].init.body).install_id, installId);
  assert.equal(ctx.fake.local.proUnlock, undefined);
  assert.equal(ctx.fake.local.installId, installId);
  assert.equal((await ctx.TS.listBackups()).length, 10);
  assert.equal(JSON.stringify(ctx.fake.local).includes('buyer@example.com'), false);
});

test('a failed release leaves Pro in place', async () => {
  const ctx = setup();
  const { pub, sign } = await signer();
  ctx.TABMOOR_PRO_KEY.jwk = { kty: 'OKP', crv: 'Ed25519', x: pub.x };
  const installId = await ctx.TSUnlock.getInstallId();
  await ctx.fake.api.storage.local.set({ proUnlock: { code: 'TABM-KEEP', token: await sign(installId), installsUsed: 1, installsMax: 3 } });
  assert.equal((await ctx.TSUnlock.release({ fetch: async () => { throw new Error('offline'); } })).reason, 'network');
  assert.equal(await ctx.TSUnlock.isUnlocked(), true);
});

test('release with nothing stored only clears a manual Pro flag', async () => {
  const ctx = setup();
  await ctx.TS.setSettings({ pro: true });
  let called = 0;
  const res = await ctx.TSUnlock.release({ fetch: async () => { called++; throw new Error('no'); } });
  assert.equal(res.localOnly, true);
  assert.equal(called, 0);
  assert.equal(await ctx.TS.isPro(), false);
});
