/* Tabmoor core: shared by background and popup. All data stays in storage.local. */
(function (g) {
  'use strict';
  const api = g.browser && g.browser.runtime ? g.browser : g.chrome;

  const DEFAULT_SETTINGS = { lang: 'auto', intervalMin: 5, pro: false };
  const LIMITS = { free: { backups: 10 }, pro: { backups: 50 } };
  const DAY_MS = 86400000;
  const DAILY_DAYS = 30;
  const MAX_URL = 8192;
  const BAD_SCHEME = /^(javascript|data|blob):/i;
  const NEWTAB = /^(chrome|edge|brave):\/\/newtab\/?$|^about:(newtab|home|blank)$|^chrome-search:/i;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let OWN = '';
  try { OWN = api.runtime.getURL(''); } catch (e) { /* ignore */ }

  function savableUrl(url) {
    return !(OWN && typeof url === 'string' && url.startsWith(OWN)) && typeof url === 'string' && url.length > 0 && url.length <= MAX_URL &&
      !BAD_SCHEME.test(url) && !NEWTAB.test(url);
  }

  async function getSettings() {
    const { settings } = await api.storage.local.get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }
  async function setSettings(patch) {
    const s = Object.assign(await getSettings(), patch);
    await api.storage.local.set({ settings: s });
    return s;
  }
  async function isPro() {
    try {
      if (g.TSUnlock && typeof g.TSUnlock.isUnlocked === 'function') return !!(await g.TSUnlock.isUnlocked());
    } catch (e) { /* use the stored flag if verification throws */ }
    const s = await getSettings();
    return !!s.pro;
  }
  async function limits() {
    return (await isPro()) ? LIMITS.pro : LIMITS.free;
  }

  /** Capture open normal, non-incognito windows. windowId limits to one window. */
  async function snapshot(windowId) {
    const wins = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const out = [];
    for (const w of wins) {
      if (w.incognito) continue;
      if (windowId != null && w.id !== windowId) continue;
      const groups = [];
      const groupIndex = new Map();
      const tabs = [];
      for (const t of w.tabs || []) {
        const url = t.url || t.pendingUrl || '';
        if (!savableUrl(url)) continue;
        const tab = { url, title: (t.title || url).slice(0, 500), pinned: !!t.pinned, active: !!t.active };
        if (typeof t.groupId === 'number' && t.groupId >= 0) {
          if (!groupIndex.has(t.groupId)) {
            let info = { title: '', color: 'grey', collapsed: false };
            try {
              if (api.tabGroups) {
                const g = await api.tabGroups.get(t.groupId);
                info = { title: (g.title || '').slice(0, 200), color: g.color || 'grey', collapsed: !!g.collapsed };
              }
            } catch (e) { /* ignore */ }
            groupIndex.set(t.groupId, groups.length);
            groups.push(info);
          }
          tab.group = groupIndex.get(t.groupId);
        }
        tabs.push(tab);
      }
      if (!tabs.length) continue;
      const win = { focused: !!w.focused, state: w.state || 'normal', tabs };
      if (w.state === 'normal') Object.assign(win, { left: w.left, top: w.top, width: w.width, height: w.height });
      if (groups.length) win.groups = groups;
      out.push(win);
    }
    return out;
  }

  function countTabs(windows) {
    return windows.reduce((n, w) => n + w.tabs.length, 0);
  }
  function fingerprint(windows) {
    return windows.map(w => w.tabs.map(t => t.url).join('\n')).join('\n--\n');
  }

  function isFirefox() {
    try { return !!(api.runtime && typeof api.runtime.getBrowserInfo === 'function'); }
    catch (e) { return false; }
  }

  /** Local calendar day, so "one backup per day" follows the browser's timezone. */
  function dayKey(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function daysAgo(created, now) {
    const a = new Date(created);
    const b = new Date(now);
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
  }

  /**
   * Keep the newest rolling backups (10 free, 50 Pro).
   * Pro also keeps the newest backup of each local day for 30 days
   * (today and the previous 29) when that copy would otherwise fall
   * out of the rolling window. One object is stored, not a duplicate.
   */
  function applyRetention(backups, opts) {
    const list = Array.isArray(backups) ? backups : [];
    const pro = !!(opts && opts.pro);
    const now = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
    const rollingMax = pro ? LIMITS.pro.backups : LIMITS.free.backups;
    const seen = new Set();
    const kept = [];
    let rollingKept = 0;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const inRolling = rollingKept < rollingMax;
      if (inRolling) rollingKept++;
      let keepDaily = false;
      if (pro && Number.isFinite(b.created)) {
        const age = daysAgo(b.created, now);
        if (age >= 0 && age < DAILY_DAYS) {
          const day = dayKey(b.created);
          if (!seen.has(day)) {
            seen.add(day);
            keepDaily = true;
          }
        }
      }
      if (inRolling || keepDaily) kept.push(b);
    }
    return kept;
  }

  async function listSessions() {
    const { sessions } = await api.storage.local.get('sessions');
    return Array.isArray(sessions) ? sessions : [];
  }
  async function listBackups() {
    const { backups } = await api.storage.local.get('backups');
    return Array.isArray(backups) ? backups : [];
  }

  async function saveSession(name, windowId) {
    const windows = await snapshot(windowId);
    if (!windows.length) return null;
    const session = {
      id: uid(),
      name: (name || '').trim().slice(0, 120) || defaultName(),
      created: Date.now(),
      windows,
    };
    const sessions = await listSessions();
    sessions.unshift(session);
    await api.storage.local.set({ sessions });
    return session;
  }

  function defaultName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `Session ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function renameSession(id, name) {
    const sessions = await listSessions();
    const s = sessions.find(x => x.id === id);
    if (!s) return false;
    s.name = (name || '').trim().slice(0, 120) || s.name;
    await api.storage.local.set({ sessions });
    return true;
  }
  async function deleteSession(id) {
    const sessions = (await listSessions()).filter(x => x.id !== id);
    await api.storage.local.set({ sessions });
  }

  function cleanTags(tags) {
    if (typeof tags === 'string') tags = tags.split(',');
    if (!Array.isArray(tags)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of tags) {
      const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 8) break;
    }
    return out;
  }

  function cleanFolder(folder) {
    return String(folder == null ? '' : folder).trim().replace(/\s+/g, ' ').slice(0, 40);
  }

  /** Tags and folders are Pro-only edits. Returns false when Pro is off. */
  async function updateSession(id, patch) {
    if (!(await isPro())) return false;
    const sessions = await listSessions();
    const s = sessions.find(x => x.id === id);
    if (!s || !patch || typeof patch !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
      const tags = cleanTags(patch.tags);
      if (tags.length) s.tags = tags;
      else delete s.tags;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'folder')) {
      const folder = cleanFolder(patch.folder);
      if (folder) s.folder = folder;
      else delete s.folder;
    }
    await api.storage.local.set({ sessions });
    return true;
  }

  /** Store a backup unless it is empty or identical to the newest one. */
  async function addBackup(windows, reason) {
    if (!windows || !windows.length) return null;
    const backups = await listBackups();
    const fp = fingerprint(windows);
    if (backups[0] && backups[0].fp === fp) return null;
    const b = { id: uid(), created: Date.now(), reason: reason || 'auto', fp, windows };
    backups.unshift(b);
    const pro = await isPro();
    const kept = applyRetention(backups, { pro, now: Date.now() });
    await api.storage.local.set({ backups: kept });
    return b;
  }

  async function enforceBackupLimit(now) {
    const pro = await isPro();
    const kept = applyRetention(await listBackups(), { pro, now: Number.isFinite(now) ? now : Date.now() });
    await api.storage.local.set({ backups: kept });
    return kept;
  }
  async function backupNow(reason) {
    return addBackup(await snapshot(), reason || 'auto');
  }

  const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  const num = v => (Number.isFinite(v) ? Math.round(v) : undefined);

  async function createWindow(w) {
    const props = { focused: true };
    const state = ['maximized', 'fullscreen'].includes(w.state) ? w.state : 'normal';
    if (state === 'normal' && num(w.width) > 100 && num(w.height) > 100) {
      Object.assign(props, { left: num(w.left), top: num(w.top), width: num(w.width), height: num(w.height) });
    }
    let created;
    try { created = await api.windows.create(props); } catch (e) { created = await api.windows.create({ focused: true }); }
    if (state !== 'normal') {
      try { await api.windows.update(created.id, { state }); } catch (e) { /* ignore */ }
    }
    return created;
  }

  /** Restore windows. Returns {windows, tabs, failed, groups}. Pro may pass {lazy:true}. */
  async function restore(windows, opts) {
    const res = { windows: 0, tabs: 0, failed: 0, groups: 0 };
    const lazy = !!(opts && opts.lazy) && await isPro();
    const firefox = isFirefox();
    for (const w of windows || []) {
      const created = await createWindow(w);
      const blankIds = (created.tabs || []).map(t => t.id);
      let activeId = null;
      let made = 0;
      const byGroup = new Map();
      for (const t of w.tabs) {
        if (!savableUrl(t.url)) { res.failed++; continue; }
        try {
          const props = { windowId: created.id, url: t.url, pinned: !!t.pinned, active: false };
          // Firefox can create the tab already discarded. Chrome discards after create.
          const discardThis = lazy && !t.active;
          if (discardThis && firefox) {
            props.discarded = true;
            props.title = String(t.title || t.url).slice(0, 500);
          }
          const tab = await api.tabs.create(props);
          res.tabs++; made++;
          if (t.active) activeId = tab.id;
          if (discardThis && !firefox && api.tabs.discard) {
            try { await api.tabs.discard(tab.id); } catch (e) { /* the tab still exists */ }
          }
          if (Number.isInteger(t.group) && !t.pinned) {
            if (!byGroup.has(t.group)) byGroup.set(t.group, []);
            byGroup.get(t.group).push(tab.id);
          }
        } catch (e) {
          res.failed++;
        }
      }
      if (made > 0 && blankIds.length) {
        try { await api.tabs.remove(blankIds); } catch (e) { /* ignore */ }
      }
      if (api.tabs.group && byGroup.size) {
        for (const [gi, ids] of byGroup) {
          try {
            const groupId = await api.tabs.group({ tabIds: ids, createProperties: { windowId: created.id } });
            const g = (w.groups || [])[gi] || {};
            if (api.tabGroups) {
              await api.tabGroups.update(groupId, {
                title: String(g.title || ''),
                color: COLORS.includes(g.color) ? g.color : 'grey',
                collapsed: !!g.collapsed,
              });
            }
            res.groups++;
          } catch (e) { /* groups are best effort */ }
        }
      }
      if (activeId != null) {
        try { await api.tabs.update(activeId, { active: true }); } catch (e) { /* ignore */ }
      }
      res.windows++;
    }
    return res;
  }

  // ---------- export / import ----------
  async function exportData() {
    return {
      app: 'tabmoor',
      format: 1,
      exported: new Date().toISOString(),
      sessions: await listSessions(),
      backups: (await listBackups()).map(({ fp, ...b }) => b),
    };
  }

  function cleanWindows(ws) {
    if (!Array.isArray(ws)) return [];
    return ws.map(w => {
      w = w || {};
      const groups = Array.isArray(w.groups) ? w.groups.slice(0, 200).map(g => ({
        title: String((g && g.title) || '').slice(0, 200),
        color: COLORS.includes(g && g.color) ? g.color : 'grey',
        collapsed: !!(g && g.collapsed),
      })) : [];
      const out = {
        focused: !!w.focused,
        state: ['normal', 'maximized', 'fullscreen', 'minimized'].includes(w.state) ? w.state : 'normal',
        tabs: (Array.isArray(w.tabs) ? w.tabs : [])
          .filter(t => t && savableUrl(t.url))
          .slice(0, 2000)
          .map(t => {
            const tab = { url: String(t.url), title: String(t.title || t.url).slice(0, 500), pinned: !!t.pinned, active: !!t.active };
            if (Number.isInteger(t.group) && t.group >= 0 && t.group < groups.length) tab.group = t.group;
            return tab;
          }),
      };
      for (const k of ['left', 'top', 'width', 'height']) if (Number.isFinite(w[k])) out[k] = Math.round(w[k]);
      if (groups.length) out.groups = groups;
      return out;
    }).filter(w => w.tabs.length);
  }

  /** Merge imported sessions (and backups as sessions are kept separately). Returns count added. */
  async function importData(obj) {
    if (!obj || !['tabmoor', 'tabsaver'].includes(obj.app) || !Array.isArray(obj.sessions)) throw new Error('format');
    const sessions = await listSessions();
    const ids = new Set(sessions.map(s => s.id));
    let added = 0;
    for (const raw of obj.sessions.slice(0, 5000)) {
      const windows = cleanWindows(raw && raw.windows);
      if (!windows.length) continue;
      let id = typeof raw.id === 'string' ? raw.id.slice(0, 40) : uid();
      if (ids.has(id)) {
        const existing = sessions.find(s => s.id === id);
        if (existing && fingerprint(existing.windows) === fingerprint(windows)) continue;
        id = uid();
      }
      ids.add(id);
      const tags = cleanTags(raw && raw.tags);
      const folder = cleanFolder(raw && raw.folder);
      const rec = {
        id,
        name: String((raw && raw.name) || defaultName()).slice(0, 120),
        created: Number(raw && raw.created) || Date.now(),
        windows,
      };
      if (tags.length) rec.tags = tags;
      if (folder) rec.folder = folder;
      sessions.push(rec);
      added++;
    }
    sessions.sort((a, b) => b.created - a.created);
    await api.storage.local.set({ sessions });
    return added;
  }

  g.TS = {
    api, uid, savableUrl, snapshot, countTabs, fingerprint,
    getSettings, setSettings, isPro, limits, LIMITS, DAILY_DAYS,
    dayKey, daysAgo, applyRetention, enforceBackupLimit, isFirefox,
    listSessions, saveSession, renameSession, deleteSession, updateSession,
    cleanTags, cleanFolder,
    listBackups, addBackup, backupNow, restore,
    exportData, importData, cleanWindows, defaultName,
  };
})(globalThis);
