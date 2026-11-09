import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function clone(v) {
  if (v === undefined) return undefined;
  return structuredClone(v);
}

export function createFakeBrowser() {
  const local = {};
  const sessionStore = {};
  const calls = [];
  const listeners = [];
  let seq = 1;
  const state = {
    windows: [],
    currentWindowId: 1,
    groups: {},
    denyPermission: false,
    uiLanguage: 'en',
  };

  function record(name, detail) {
    calls.push({ name, detail });
  }

  function notify(changes) {
    for (const fn of listeners) fn(changes, 'local');
  }

  const api = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(local);
          if (typeof keys === 'string') return keys in local ? { [keys]: clone(local[keys]) } : {};
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (k in local) out[k] = clone(local[k]);
            return out;
          }
          return clone(local);
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj || {})) {
            changes[k] = { oldValue: clone(local[k]), newValue: clone(v) };
            local[k] = clone(v);
          }
          notify(changes);
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          for (const k of list) {
            changes[k] = { oldValue: clone(local[k]), newValue: undefined };
            delete local[k];
          }
          notify(changes);
        },
      },
      session: {
        async get(keys) {
          if (typeof keys === 'string') return keys in sessionStore ? { [keys]: clone(sessionStore[keys]) } : {};
          return clone(sessionStore);
        },
        async set(obj) {
          Object.assign(sessionStore, clone(obj));
        },
        async remove(keys) {
          for (const k of (Array.isArray(keys) ? keys : [keys])) delete sessionStore[k];
        },
      },
      onChanged: { addListener(fn) { listeners.push(fn); } },
    },
    runtime: {
      id: 'tabmoor-test',
      getURL(p) { return 'chrome-extension://tabmoor-test/' + (p || ''); },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    i18n: { getUILanguage: () => state.uiLanguage },
    windows: {
      async getAll() { record('windows.getAll'); return clone(state.windows); },
      async getCurrent() {
        return clone(state.windows.find(w => w.id === state.currentWindowId) || state.windows[0] || { id: 1 });
      },
      async create(props) {
        record('windows.create', clone(props));
        const id = ++seq;
        const win = {
          id,
          state: 'normal',
          type: 'normal',
          focused: true,
          left: props && props.left,
          top: props && props.top,
          width: props && props.width,
          height: props && props.height,
          tabs: [{ id: ++seq, url: 'about:blank' }],
        };
        state.windows.push(win);
        return clone(win);
      },
      async update(id, props) {
        record('windows.update', { id, props: clone(props) });
        return { id, ...props };
      },
      onRemoved: { addListener() {} },
      onBoundsChanged: { addListener() {} },
    },
    tabs: {
      async create(props) {
        record('tabs.create', clone(props));
        return { id: ++seq, ...clone(props) };
      },
      async remove(ids) { record('tabs.remove', clone(ids)); },
      async update(id, props) { record('tabs.update', { id, props: clone(props) }); },
      async group(props) { record('tabs.group', clone(props)); return ++seq; },
      async discard(id) { record('tabs.discard', id); },
      onCreated: { addListener() {} },
      onUpdated: { addListener() {} },
      onMoved: { addListener() {} },
      onAttached: { addListener() {} },
      onRemoved: { addListener() {} },
      onDetached: { addListener() {} },
    },
    tabGroups: {
      async get(id) {
        record('tabGroups.get', id);
        return clone(state.groups[id] || { id, title: '', color: 'grey', collapsed: false });
      },
      async update(id, props) { record('tabGroups.update', { id, props: clone(props) }); },
      onUpdated: { addListener() {} },
      onCreated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    alarms: {
      async get() { return null; },
      async create() {},
      onAlarm: { addListener() {} },
    },
    permissions: {
      async request(req) {
        record('permissions.request', clone(req));
        if (state.denyPermission) return false;
        state.granted = clone(req);
        return true;
      },
      async contains() { return !!state.granted; },
      async getAll() { return { origins: [], permissions: [] }; },
    },
    commands: { onCommand: { addListener() {} } },
  };

  return { api, calls, local, state, sessionStore };
}

export function loadTabmoor(fake, opts) {
  opts = opts || {};
  const firefox = !!opts.firefox;
  const context = {
    console,
    URL,
    URLSearchParams,
    navigator: {
      userAgent: opts.userAgent || (firefox
        ? 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
        : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'),
      language: 'en',
    },
  };
  vm.createContext(context);
  context.atob = atob;
  context.btoa = btoa;
  context.TextEncoder = TextEncoder;
  context.TextDecoder = TextDecoder;
  context.crypto = globalThis.crypto;
  if (firefox) {
    fake.api.runtime.getBrowserInfo = async () => ({ name: 'Firefox', version: '140.0' });
    context.browser = fake.api;
  }
  context.chrome = fake.api;
  const dir = path.join(root, 'extension');
  const files = ['core.js', 'i18n.js'];
  if (opts.unlock) files.push('pro-key.js', 'unlock.js');
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  }
  return context;
}

export function callsNamed(fake, name) {
  return fake.calls.filter(c => c.name === name);
}

export function win(url, extra) {
  const tab = Object.assign({ url, title: url, pinned: false, active: true }, extra || {});
  return [{ focused: true, state: 'normal', width: 800, height: 600, tabs: [tab] }];
}

export const rootDir = root;
