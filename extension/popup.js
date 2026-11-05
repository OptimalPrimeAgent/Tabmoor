(function () {
  'use strict';
  const api = TS.api;
  const $ = id => document.getElementById(id);
  const pageParams = new URLSearchParams(location.search);
  const isPage = pageParams.has('page');
  if (isPage) document.body.classList.add('page');

  let lang = 'en';
  let T = TSI18N.STR.en;
  let view = 'sessions';
  let pendingDelete = null;
  let pendingDeactivate = false;
  let proBusy = false;
  let proMessage = '';
  let licenseDraft = '';
  let isPro = false;
  let knownLicense = null;
  let folderFilter = '';
  let tagFilter = '';
  const expanded = new Set();

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString(lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function meta(windows, created, session) {
    const bits = [T.windows(windows.length), T.tabs(TS.countTabs(windows)), fmtDate(created)];
    if (isPro && session && session.folder) bits.unshift(session.folder);
    return bits.join(' · ');
  }

  function licMessage(reason) {
    if (reason === 'permission') return T.licPermission;
    if (reason === 'network') return T.licNetwork;
    if (reason === 'product') return T.licProduct;
    if (reason === 'config') return T.licConfig;
    return T.licInvalid;
  }

  function renderProBox() {
    const box = $('proBox');
    const kids = [el('strong', null, isPro ? T.proActive : T.pro)];
    if (!isPro) kids.push(el('p', { class: 'muted' }, T.proPrice));
    kids.push(el('ul', null, ...T.proItems.map(s => el('li', null, s))));
    if (isPro) {
      const btn = el('button', { type: 'button', class: 'danger', 'data-act': 'deactivate' }, proBusy ? T.deactivating : (pendingDeactivate ? T.confirmDeactivate : T.deactivate));
      if (proBusy) btn.disabled = true;
      kids.push(btn);
    } else {
      const url = (globalThis.TSLicense && TSLicense.checkoutUrl) ? TSLicense.checkoutUrl() : '';
      if (url) kids.push(el('p', null, el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, T.proBuy)));
      else kids.push(el('p', { class: 'muted' }, T.proBuyMissing));
      const input = el('input', { id: 'licenseKey', type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false' });
      input.placeholder = T.licensePh;
      input.value = licenseDraft;
      input.addEventListener('input', () => { licenseDraft = input.value; });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') onActivate(); });
      kids.push(input);
      const btn = el('button', { type: 'button', class: 'primary', 'data-act': 'activate' }, proBusy ? T.activating : T.activate);
      if (proBusy) btn.disabled = true;
      kids.push(btn);
    }
    if (proMessage) kids.push(el('p', { class: 'proStatus', role: 'status' }, proMessage));
    box.replaceChildren(...kids);
  }

  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(n => { const v = T[n.dataset.t]; if (typeof v === 'string') n.textContent = v; });
    document.querySelectorAll('[data-ph]').forEach(n => { n.placeholder = T[n.dataset.ph]; });
    renderProBox();
    $('openTab').hidden = isPage;
    $('toast').classList.remove('show');
  }

  function tabList(windows) {
    const ol = el('ol');
    windows.forEach(w => w.tabs.forEach(t => ol.append(el('li', { title: t.url }, t.title || t.url))));
    return ol;
  }

  async function doRestore(windows) {
    const pro = !!(await TS.getSettings()).pro;
    const r = await TS.restore(windows, { lazy: pro });
    toast(T.restored(r.tabs, r.failed));
  }

  function matches(s, q) {
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    if (isPro && (s.folder || '').toLowerCase().includes(q)) return true;
    if (isPro && (s.tags || []).some(t => t.toLowerCase().includes(q))) return true;
    return s.windows.some(w => w.tabs.some(t => (t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q)));
  }

  function fillFolders(sessions) {
    const sel = $('folderFilter');
    const names = [];
    const seen = new Set();
    for (const s of sessions) {
      if (s.folder && !seen.has(s.folder)) { seen.add(s.folder); names.push(s.folder); }
    }
    names.sort((a, b) => a.localeCompare(b, lang === 'da' ? 'da' : 'en'));
    const current = names.includes(folderFilter) ? folderFilter : '';
    folderFilter = current;
    sel.replaceChildren(
      el('option', { value: '' }, T.allFolders),
      ...names.map(n => el('option', { value: n }, n)),
    );
    sel.value = current;
    const clear = $('tagClear');
    clear.hidden = !(isPro && tagFilter);
    clear.textContent = tagFilter ? `${tagFilter} ×` : '';
  }

  function chips(s) {
    if (!isPro || !s.tags || !s.tags.length) return null;
    return el('div', { class: 'chips' }, ...s.tags.map(t => el('button', {
      type: 'button',
      class: tagFilter === t ? 'chip on' : 'chip',
      onclick: () => { tagFilter = tagFilter === t ? '' : t; renderSessions(); },
    }, t)));
  }

  function startMeta(li, s, field) {
    const input = el('input', { type: 'text', maxlength: field === 'folder' ? '40' : '200' });
    input.value = field === 'folder' ? (s.folder || '') : (s.tags || []).join(', ');
    input.placeholder = field === 'folder' ? T.folderPh : T.tagsPh;
    let finished = false;
    const done = async save => {
      if (finished) return;
      finished = true;
      if (save) {
        if (field === 'folder') await TS.updateSession(s.id, { folder: input.value });
        else await TS.updateSession(s.id, { tags: input.value.split(',') });
      }
      renderSessions();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    li.querySelector('.meta').insertAdjacentElement('afterend', input);
    input.focus();
    input.select();
  }

  async function renderSessions() {
    const all = await TS.listSessions();
    const q = $('search').value.trim().toLowerCase();
    if (isPro) fillFolders(all);
    const list = all.filter(s => {
      if (isPro && folderFilter && s.folder !== folderFilter) return false;
      if (isPro && tagFilter && !(s.tags || []).includes(tagFilter)) return false;
      return matches(s, q);
    });
    const ul = $('sessionList');
    if (!all.length) return ul.replaceChildren(el('li', { class: 'empty' }, T.noSessions));
    if (!list.length) return ul.replaceChildren(el('li', { class: 'empty' }, T.noMatch));
    ul.replaceChildren(...list.map(s => {
      const open = expanded.has(s.id) || !!q;
      const nameNode = el('span', { class: 'name', title: s.name }, s.name);
      const li = el('li', { class: 'item', 'data-id': s.id },
        el('div', { class: 'top' }, nameNode,
          el('button', { class: 'primary', type: 'button', 'data-act': 'restore', onclick: () => doRestore(s.windows) }, T.restore)),
        el('div', { class: 'meta' }, meta(s.windows, s.created, s)),
        el('div', { class: 'actions' },
          el('button', { type: 'button', onclick: () => { open ? expanded.delete(s.id) : expanded.add(s.id); renderSessions(); } }, open ? T.hideTabs : T.showTabs),
          el('button', { type: 'button', 'data-act': 'rename', onclick: () => startRename(li, s) }, T.rename),
          isPro ? el('button', { type: 'button', 'data-act': 'folder', onclick: () => startMeta(li, s, 'folder') }, T.folder) : null,
          isPro ? el('button', { type: 'button', 'data-act': 'tags', onclick: () => startMeta(li, s, 'tags') }, T.tags) : null,
          el('button', { type: 'button', class: 'danger', 'data-act': 'delete', onclick: async () => {
            if (pendingDelete === s.id) { pendingDelete = null; await TS.deleteSession(s.id); renderSessions(); }
            else { pendingDelete = s.id; renderSessions(); }
          } }, pendingDelete === s.id ? T.confirmDel : T.del)),
        chips(s),
        open ? tabList(s.windows) : null);
      return li;
    }));
  }

  function startRename(li, s) {
    const input = el('input', { type: 'text', maxlength: '120' });
    input.value = s.name;
    let finished = false;
    const done = async save => {
      if (finished) return;
      finished = true;
      if (save) await TS.renameSession(s.id, input.value);
      renderSessions();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    li.querySelector('.name').replaceWith(input);
    input.focus();
    input.select();
  }

  async function renderBackups() {
    const backups = await TS.listBackups();
    const lim = await TS.limits();
    const pro = !!(await TS.getSettings()).pro;
    $('keep').textContent = pro ? T.keepPro(lim.backups) : T.keep(lim.backups);
    const ul = $('backupList');
    if (!backups.length) return ul.replaceChildren(el('li', { class: 'empty' }, T.noBackups));
    ul.replaceChildren(...backups.map((b, i) => {
      const open = expanded.has(b.id);
      const reason = T['reason_' + b.reason] || b.reason;
      const label = pro && i >= lim.backups ? `${T.dailyMark}: ${reason}` : reason;
      return el('li', { class: 'item' },
        el('div', { class: 'top' },
          el('span', { class: 'name' }, label),
          el('button', { class: 'primary', type: 'button', onclick: () => doRestore(b.windows) }, T.restore)),
        el('div', { class: 'meta' }, meta(b.windows, b.created)),
        el('div', { class: 'actions' },
          el('button', { type: 'button', onclick: () => { open ? expanded.delete(b.id) : expanded.add(b.id); renderBackups(); } }, open ? T.hideTabs : T.showTabs),
          el('button', { type: 'button', onclick: async () => {
            const sessions = await TS.listSessions();
            sessions.unshift({ id: TS.uid(), name: `${T.backups}: ${fmtDate(b.created)}`, created: Date.now(), windows: b.windows });
            await api.storage.local.set({ sessions });
            toast(T.saved);
          } }, T.saveAsSession)),
        open ? tabList(b.windows) : null);
    }));
  }

  async function loadFlags() {
    const s = await TS.getSettings();
    isPro = !!s.pro;
    const { license } = await api.storage.local.get('license');
    knownLicense = license && license.key && license.instanceId
      ? { key: license.key, instanceId: license.instanceId }
      : null;
    return s;
  }

  async function render() {
    isPro = !!(await TS.getSettings()).pro;
    $('filters').hidden = !isPro;
    $('paneSessions').hidden = view !== 'sessions';
    $('paneBackups').hidden = view !== 'backups';
    $('paneSettings').hidden = view !== 'settings';
    $('tabSessions').classList.toggle('active', view === 'sessions');
    $('tabBackups').classList.toggle('active', view === 'backups');
    $('tabSettings').classList.toggle('active', view === 'settings');
    if (view === 'sessions') await renderSessions();
    if (view === 'backups') await renderBackups();
  }

  async function onActivate() {
    if (proBusy) return;
    const input = $('licenseKey');
    const raw = input ? input.value : licenseDraft;
    licenseDraft = raw;
    if (!String(raw || '').trim()) { proMessage = T.licEmpty; renderProBox(); return; }
    // Chrome and Firefox close the popup when the permission dialog opens, so the
    // request has to run from the stable tab. Same reason the file import does.
    if (!isPage) {
      try {
        if (api.storage.session) await api.storage.session.set({ licenseDraft: String(raw).trim() });
        await api.tabs.create({ url: api.runtime.getURL('popup.html?page=1&pro=1') });
      } catch (e) {
        proMessage = T.licNetwork;
        renderProBox();
        return;
      }
      window.close();
      return;
    }
    proBusy = true;
    proMessage = '';
    const btn = document.querySelector('[data-act="activate"]');
    if (btn) btn.disabled = true;
    try {
      const res = await TSLicense.activate(String(raw).trim());
      await loadFlags();
      if (res.ok) { licenseDraft = ''; pendingDeactivate = false; proMessage = T.activatedOk; toast(T.activatedOk); }
      else proMessage = licMessage(res.reason);
    } catch (e) {
      proMessage = T.licNetwork;
    } finally {
      proBusy = false;
      renderProBox();
      render();
    }
  }

  async function onDeactivate() {
    if (proBusy) return;
    if (!isPage) {
      try { await api.tabs.create({ url: api.runtime.getURL('popup.html?page=1&pro=deactivate') }); }
      catch (e) { proMessage = T.licNetwork; renderProBox(); return; }
      window.close();
      return;
    }
    if (!pendingDeactivate) { pendingDeactivate = true; proMessage = ''; renderProBox(); return; }
    pendingDeactivate = false;
    proBusy = true;
    proMessage = '';
    // Permission request starts inside deactivate, before any await, while this click is active.
    try {
      const res = await TSLicense.deactivate({ knownLicense });
      await loadFlags();
      proMessage = res.ok ? T.deactivatedOk : licMessage(res.reason);
      if (res.ok) toast(T.deactivatedOk);
    } catch (e) {
      proMessage = T.licNetwork;
    } finally {
      proBusy = false;
      renderProBox();
      render();
    }
  }

  async function save(windowOnly) {
    let windowId;
    if (windowOnly) windowId = (await api.windows.getCurrent()).id;
    const s = await TS.saveSession($('name').value, windowId);
    if (!s) return toast(T.nothing);
    $('name').value = '';
    $('search').value = '';
    view = 'sessions';
    toast(`${T.saved}: ${s.name}`);
    render();
  }

  async function doExport() {
    const data = await TS.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date().toISOString().slice(0, 10);
    const a = el('a', { href: url, download: `tabmoor-export-${d}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function doImport(file) {
    try {
      const n = await TS.importData(JSON.parse(await file.text()));
      toast(T.imported(n));
      view = 'sessions';
      render();
    } catch (e) {
      toast(T.importErr);
    }
  }

  async function init() {
    const s = await loadFlags();
    lang = TSI18N.pick(s.lang);
    T = TSI18N.STR[lang];
    if (isPage && pageParams.get('pro') === '1' && api.storage.session) {
      view = 'settings';
      const got = await api.storage.session.get('licenseDraft');
      if (got && got.licenseDraft) {
        licenseDraft = String(got.licenseDraft);
        if (api.storage.session.remove) await api.storage.session.remove('licenseDraft');
      }
      proMessage = T.licAgain;
    } else if (isPage && pageParams.get('pro') === 'deactivate') {
      view = 'settings';
      proMessage = T.deactivateHere;
    }
    $('lang').value = s.lang;
    $('interval').value = String(s.intervalMin);
    applyStatic();

    $('saveAll').addEventListener('click', () => save(false));
    $('saveWin').addEventListener('click', () => save(true));
    $('name').addEventListener('keydown', e => { if (e.key === 'Enter') save(false); });
    $('search').addEventListener('input', () => renderSessions());
    $('folderFilter').addEventListener('change', e => { folderFilter = e.target.value; renderSessions(); });
    $('tagClear').addEventListener('click', () => { tagFilter = ''; renderSessions(); });
    $('proBox').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'activate') onActivate();
      if (btn.dataset.act === 'deactivate') onDeactivate();
    });
    $('tabSessions').addEventListener('click', () => { view = 'sessions'; render(); });
    $('tabBackups').addEventListener('click', () => { view = 'backups'; render(); });
    $('tabSettings').addEventListener('click', () => { view = 'settings'; render(); });
    $('backupNow').addEventListener('click', async () => {
      const b = await TS.backupNow('manual');
      toast(b ? T.backupDone : T.backupSame);
      renderBackups();
    });
    $('lang').addEventListener('change', async e => {
      const st = await TS.setSettings({ lang: e.target.value });
      lang = TSI18N.pick(st.lang); T = TSI18N.STR[lang]; applyStatic(); render();
    });
    $('interval').addEventListener('change', e => TS.setSettings({ intervalMin: Number(e.target.value) }));
    $('exportBtn').addEventListener('click', doExport);
    // Firefox closes popups when a file dialog opens, so import runs from the tab view.
    $('importBtn').addEventListener('click', () => {
      if (!isPage && /firefox/i.test(navigator.userAgent)) return api.tabs.create({ url: api.runtime.getURL('popup.html?page=1') });
      $('importFile').click();
    });
    $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) doImport(f); e.target.value = ''; });
    $('openTab').addEventListener('click', () => { api.tabs.create({ url: api.runtime.getURL('popup.html?page=1') }); window.close(); });
    api.storage.onChanged.addListener((c, area) => {
      if (area !== 'local') return;
      if (c.settings || c.license) loadFlags().then(() => { renderProBox(); render(); });
      else if (c.sessions || c.backups) render();
    });
    render();
  }
  init();
})();
