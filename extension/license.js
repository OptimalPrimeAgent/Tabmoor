/* Tabmoor Pro: one Lemon Squeezy activate, one deactivate, then fully local. */
(function (g) {
  'use strict';

  function api() {
    if (g.TS && g.TS.api) return g.TS.api;
    return g.browser && g.browser.runtime ? g.browser : g.chrome;
  }

  function configOf(deps) {
    return (deps && deps.config) || g.TABMOOR_LEMON;
  }

  function currentUa(explicit) {
    if (explicit) return String(explicit);
    try { return (g.navigator && g.navigator.userAgent) || ''; }
    catch (e) { return ''; }
  }

  /** Human label only. No device id, no account name. */
  function instanceName(ua) {
    const s = currentUa(ua);
    let browser = 'Chrome';
    if (/Firefox/i.test(s)) browser = 'Firefox';
    else if (/Edg\//i.test(s)) browser = 'Edge';
    return 'Tabmoor on ' + browser;
  }

  function configured(cfg) {
    if (!cfg) return false;
    const store = String(cfg.STORE_ID == null ? '' : cfg.STORE_ID).trim();
    const product = String(cfg.PRODUCT_ID == null ? '' : cfg.PRODUCT_ID).trim();
    if (!store || !product) return false;
    if (store === 'LEMON_STORE_ID' || product === 'LEMON_PRODUCT_ID') return false;
    return true;
  }

  function checkoutUrl(cfg) {
    const u = String((cfg || g.TABMOOR_LEMON || {}).CHECKOUT_URL || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(u)) return '';
    return u;
  }

  function normalizeKey(key) {
    return String(key || '').replace(/\s+/g, '').slice(0, 200);
  }

  function permissionRequest(cfg, ua) {
    const req = { origins: [cfg.ORIGIN] };
    // Firefox's optional data-collection consent. Chrome has no such key.
    if (/Firefox/i.test(currentUa(ua))) req.data_collection = ['authenticationInfo'];
    return req;
  }

  /**
   * Starts permissions.request synchronously so a click handler can await it
   * without losing the user gesture. Call this before any other await.
   */
  function preparePermission(deps) {
    const cfg = configOf(deps);
    const permissions = (deps && deps.permissions) || api().permissions;
    if (!permissions || typeof permissions.request !== 'function') {
      return Promise.resolve({ ok: false, reason: 'permission' });
    }
    const req = permissionRequest(cfg, deps && deps.userAgent);
    try {
      return Promise.resolve(permissions.request(req)).then(
        function (ok) { return ok ? { ok: true } : { ok: false, reason: 'permission' }; },
        function () { return { ok: false, reason: 'permission' }; }
      );
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'permission' });
    }
  }

  /**
   * Copy only the fields Tabmoor needs. Customer name, email and id are not read.
   */
  function pick(raw) {
    const meta = raw && raw.meta && typeof raw.meta === 'object' ? raw.meta : null;
    const instance = raw && raw.instance && typeof raw.instance === 'object' ? raw.instance : null;
    const license = raw && raw.license_key && typeof raw.license_key === 'object' ? raw.license_key : null;
    const idRaw = instance ? instance.id : '';
    const instanceId = (typeof idRaw === 'string' || typeof idRaw === 'number') && String(idRaw) ? String(idRaw) : '';
    const error = raw && typeof raw.error === 'string' ? raw.error : '';
    return {
      activated: !!(raw && raw.activated === true),
      deactivated: !!(raw && raw.deactivated === true),
      status: license && typeof license.status === 'string' ? license.status : '',
      instanceId: instanceId,
      storeId: meta ? meta.store_id : undefined,
      productId: meta ? meta.product_id : undefined,
      notFound: /not found/i.test(error),
    };
  }

  function idsMatch(body, cfg) {
    if (!body) return false;
    return String(body.storeId) === String(cfg.STORE_ID) && String(body.productId) === String(cfg.PRODUCT_ID);
  }

  async function postForm(fetchFn, url, params) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const text = await res.text();
    let raw = null;
    try { raw = JSON.parse(text); } catch (e) { raw = null; }
    return { status: res.status, body: pick(raw) };
  }

  function storageOf(deps) {
    return (deps && deps.storage) || api().storage;
  }

  function fetchOf(deps) {
    if (deps && deps.fetch) return deps.fetch;
    if (typeof g.fetch === 'function') return g.fetch.bind(g);
    return null;
  }

  async function readLicense(storage) {
    const got = await storage.local.get('license');
    const license = got && got.license;
    if (!license || typeof license !== 'object') return null;
    const key = typeof license.key === 'string' ? license.key : '';
    const instanceId = typeof license.instanceId === 'string' ? license.instanceId : '';
    if (!key || !instanceId) return null;
    return { key: key, instanceId: instanceId, activatedAt: Number(license.activatedAt) || 0 };
  }

  async function writeLicense(storage, rec) {
    await storage.local.set({
      license: { key: rec.key, instanceId: rec.instanceId, activatedAt: rec.activatedAt },
    });
  }

  async function setPro(deps, value) {
    const setSettings = (deps && deps.setSettings) || function (patch) { return g.TS.setSettings(patch); };
    await setSettings({ pro: value });
  }

  async function clearLocal(deps) {
    const storage = storageOf(deps);
    if (storage.local.remove) await storage.local.remove('license');
    else await storage.local.set({ license: null });
    await setPro(deps, false);
    if (deps && deps.enforceLimits) await deps.enforceLimits();
    else if (g.TS && g.TS.enforceBackupLimit) await g.TS.enforceBackupLimit();
  }

  async function release(fetchFn, cfg, key, instanceId) {
    try {
      await postForm(fetchFn, cfg.DEACTIVATE_URL, { license_key: key, instance_id: instanceId });
    } catch (e) { /* still refuse to unlock */ }
  }

  async function activate(key, deps) {
    deps = deps || {};
    const cfg = configOf(deps);
    const trimmed = normalizeKey(key);
    if (!trimmed) return { ok: false, reason: 'invalid' };
    if (!configured(cfg)) return { ok: false, reason: 'config' };
    const perm = await preparePermission(deps);
    if (!perm.ok) return { ok: false, reason: 'permission' };
    const fetchFn = fetchOf(deps);
    if (!fetchFn) return { ok: false, reason: 'network' };
    let result;
    try {
      result = await postForm(fetchFn, cfg.ACTIVATE_URL, {
        license_key: trimmed,
        instance_name: instanceName(deps.userAgent),
      });
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
    const body = result.body;
    const badStatus = body && (body.status === 'expired' || body.status === 'disabled');
    if (!body || !body.activated || !body.instanceId || badStatus) {
      if (body && body.activated && body.instanceId) await release(fetchFn, cfg, trimmed, body.instanceId);
      return { ok: false, reason: 'invalid' };
    }
    if (!idsMatch(body, cfg)) {
      await release(fetchFn, cfg, trimmed, body.instanceId);
      return { ok: false, reason: 'product' };
    }
    await writeLicense(storageOf(deps), {
      key: trimmed,
      instanceId: body.instanceId,
      activatedAt: Number.isFinite(deps.now) ? deps.now : Date.now(),
    });
    await setPro(deps, true);
    return { ok: true };
  }

  async function deactivate(deps) {
    deps = deps || {};
    const cfg = configOf(deps);
    const storage = storageOf(deps);
    let known = deps.knownLicense;
    if (known === undefined) known = await readLicense(storage);
    else if (known && known.key && known.instanceId) known = { key: String(known.key), instanceId: String(known.instanceId) };
    else known = null;
    if (!known) {
      await clearLocal(deps);
      return { ok: true, localOnly: true };
    }
    const perm = await preparePermission(deps);
    if (!perm.ok) return { ok: false, reason: 'permission' };
    const fetchFn = fetchOf(deps);
    if (!fetchFn) return { ok: false, reason: 'network' };
    let result;
    try {
      result = await postForm(fetchFn, cfg.DEACTIVATE_URL, {
        license_key: known.key,
        instance_id: known.instanceId,
      });
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
    const body = result.body;
    const gone = result.status === 404 || (body && body.notFound);
    if (!body || (!body.deactivated && !gone)) return { ok: false, reason: 'invalid' };
    await clearLocal(deps);
    return { ok: true };
  }

  g.TSLicense = {
    activate: activate,
    deactivate: deactivate,
    preparePermission: preparePermission,
    instanceName: instanceName,
    configured: configured,
    checkoutUrl: checkoutUrl,
    permissionRequest: permissionRequest,
    normalizeKey: normalizeKey,
    pick: pick,
    idsMatch: idsMatch,
  };
})(globalThis);
