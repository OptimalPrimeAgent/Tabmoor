/* Redeem or release once. After that Pro is checked offline. No host permission:
   the worker answers CORS for chrome-extension:// and moz-extension:// origins. */
(function (g) {
  'use strict';
  const INSTALL_RE = /^[A-Za-z0-9-]{8,64}$/;

  function api() {
    if (g.TS && g.TS.api) return g.TS.api;
    return g.browser && g.browser.runtime ? g.browser : g.chrome;
  }
  function urls(deps) { return (deps && deps.urls) || g.TABMOOR_UNLOCK; }
  function cryptoOf(deps) { return (deps && deps.crypto) || g.crypto; }
  function storageOf(deps) { return (deps && deps.storage) || api().storage; }
  function fetchOf(deps) {
    if (deps && deps.fetch) return deps.fetch;
    if (typeof g.fetch === 'function') return g.fetch.bind(g);
    return null;
  }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function b64urlDecode(s) {
    const src = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const pad = src.length % 4 === 0 ? '' : '='.repeat(4 - (src.length % 4));
    const bin = atob(src + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function publicJwk() {
    const src = g.TABMOOR_PRO_KEY && g.TABMOOR_PRO_KEY.jwk;
    if (!src || typeof src.x !== 'string' || !src.x) return null;
    return { kty: 'OKP', crv: 'Ed25519', x: src.x };
  }
  function newInstallId(c) {
    if (c && typeof c.randomUUID === 'function') {
      const id = c.randomUUID();
      if (INSTALL_RE.test(id)) return id;
    }
    const bytes = new Uint8Array(16);
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('rng');
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  async function existingInstallId(deps) {
    const got = await storageOf(deps).local.get('installId');
    if (got && typeof got.installId === 'string' && INSTALL_RE.test(got.installId)) return got.installId;
    return '';
  }
  async function getInstallId(deps) {
    const existing = await existingInstallId(deps);
    if (existing) return existing;
    const id = newInstallId(cryptoOf(deps));
    await storageOf(deps).local.set({ installId: id });
    return id;
  }
  async function verifyToken(token, installId, deps) {
    if (typeof token !== 'string' || !INSTALL_RE.test(installId || '')) return { ok: false, reason: 'token' };
    const trimmed = token.trim();
    const dot = trimmed.indexOf('.');
    if (dot <= 0 || dot !== trimmed.lastIndexOf('.') || dot === trimmed.length - 1) return { ok: false, reason: 'token' };
    const c = cryptoOf(deps);
    const jwk = publicJwk();
    if (!c || !c.subtle || !jwk) return { ok: false, reason: 'crypto' };
    try {
      const key = await c.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
      const ok = await c.subtle.verify(
        { name: 'Ed25519' }, key, b64urlDecode(trimmed.slice(dot + 1)),
        new TextEncoder().encode(trimmed.slice(0, dot))
      );
      if (!ok) return { ok: false, reason: 'token' };
      const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(trimmed.slice(0, dot))));
      if (!payload || payload.t !== 'pro' || payload.i !== installId) return { ok: false, reason: 'token' };
      return { ok: true, payload };
    } catch (e) {
      return { ok: false, reason: 'token' };
    }
  }
  async function readUnlock(deps) {
    const got = await storageOf(deps).local.get('proUnlock');
    const rec = got && got.proUnlock;
    if (!rec || typeof rec.code !== 'string' || typeof rec.token !== 'string') return null;
    return { code: rec.code, token: rec.token, installsUsed: num(rec.installsUsed), installsMax: num(rec.installsMax) };
  }
  async function isUnlocked(deps) {
    const rec = await readUnlock(deps);
    const installId = await existingInstallId(deps);
    if (!rec || !installId) return false;
    return !!(await verifyToken(rec.token, installId, deps)).ok;
  }
  function mapError(status, body) {
    const err = body && typeof body.error === 'string' ? body.error : '';
    if (status === 429 || err === 'rate_limited') return 'rate_limited';
    if (status === 404 || err === 'invalid_code') return 'invalid_code';
    if (err === 'limit_reached') return 'limit_reached';
    if (err === 'revoked') return 'revoked';
    if (err === 'bad_install_id') return 'bad_install_id';
    if (err === 'bad_request' || status === 400) return 'bad_request';
    if (status >= 200 && status < 300) return '';
    return 'network';
  }
  async function postJson(fetchFn, url, body) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors',
    });
    let parsed = null;
    try { parsed = JSON.parse(await res.text()); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    return { status: res.status, json: parsed };
  }
  async function setProFlag(deps, value) {
    const setSettings = (deps && deps.setSettings) || function (patch) { return g.TS.setSettings(patch); };
    await setSettings({ pro: !!value });
  }
  async function clearLocal(deps) {
    const storage = storageOf(deps);
    if (storage.local.remove) await storage.local.remove('proUnlock');
    else await storage.local.set({ proUnlock: null });
    await setProFlag(deps, false);
    if (g.TS && g.TS.enforceBackupLimit) await g.TS.enforceBackupLimit();
  }
  async function redeem(code, deps) {
    deps = deps || {};
    const cleaned = String(code == null ? '' : code).trim().slice(0, 80);
    if (!cleaned) return { ok: false, reason: 'empty' };
    const fetchFn = fetchOf(deps);
    if (!fetchFn) return { ok: false, reason: 'network' };
    const installId = await getInstallId(deps);
    let result;
    try { result = await postJson(fetchFn, urls(deps).REDEEM_URL, { code: cleaned, install_id: installId }); }
    catch (e) { return { ok: false, reason: 'network' }; }
    const reason = mapError(result.status, result.json);
    if (reason) return { ok: false, reason, installsUsed: num(result.json.installs_used), installsMax: num(result.json.installs_max) };
    const verdict = await verifyToken(result.json.token, installId, deps);
    if (!verdict.ok) return { ok: false, reason: verdict.reason || 'token' };
    const stored = { code: cleaned, token: String(result.json.token).trim() };
    const used = num(result.json.installs_used);
    const max = num(result.json.installs_max);
    if (used != null) stored.installsUsed = used;
    if (max != null) stored.installsMax = max;
    await storageOf(deps).local.set({ proUnlock: stored });
    await setProFlag(deps, true);
    return { ok: true, installsUsed: used, installsMax: max };
  }
  async function release(deps) {
    deps = deps || {};
    const rec = await readUnlock(deps);
    if (!rec) { await clearLocal(deps); return { ok: true, localOnly: true }; }
    const fetchFn = fetchOf(deps);
    if (!fetchFn) return { ok: false, reason: 'network' };
    const installId = await getInstallId(deps);
    let result;
    try { result = await postJson(fetchFn, urls(deps).RELEASE_URL, { code: rec.code, install_id: installId }); }
    catch (e) { return { ok: false, reason: 'network' }; }
    const reason = mapError(result.status, result.json);
    if (reason || result.json.ok !== true) return { ok: false, reason: reason || 'network' };
    await clearLocal(deps);
    return { ok: true, released: !!result.json.released, installsUsed: num(result.json.installs_used), installsMax: num(result.json.installs_max) };
  }
  async function status(deps) {
    const on = await isUnlocked(deps);
    const rec = on ? await readUnlock(deps) : null;
    return { pro: on, installsUsed: rec ? rec.installsUsed : null, installsMax: rec ? rec.installsMax : null };
  }
  g.TSUnlock = { INSTALL_RE, getInstallId, verifyToken, isUnlocked, redeem, release, status, readUnlock };
})(globalThis);
