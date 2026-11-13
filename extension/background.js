/* Tabmoor background: rolling backups. Chrome loads core.js via importScripts, Firefox via manifest scripts. */
if (typeof importScripts === 'function') {
  if (typeof TS === 'undefined') importScripts('core.js');
  if (typeof TSUnlock === 'undefined') importScripts('pro-key.js', 'unlock.js');
}
const api = TS.api;
const ALARM = 'tabmoor-backup';
let liveTimer = null;

async function ensureAlarm() {
  const s = await TS.getSettings();
  const period = Math.max(1, Number(s.intervalMin) || 5);
  const existing = await api.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await api.alarms.create(ALARM, { periodInMinutes: period });
  }
}

/** Keep a copy of the current state so a window that closes can still be backed up. */
async function refreshLive() {
  const windows = await TS.snapshot();
  // Never replace the last known state with nothing: when the browser quits, the last window
  // closes first and the old state is needed for the 'startup' backup on the next launch.
  if (!windows.length) return;
  await api.storage.local.set({ live: { at: Date.now(), windows } });
}
function scheduleLive() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { refreshLive().catch(() => {}); }, 1500);
}

api.runtime.onInstalled.addListener(async () => { await backupLastSession(); ensureAlarm(); refreshLive(); });
/**
 * Once per browser session, turn the previous session's last known state into a 'startup' backup.
 * storage.session is cleared when the browser quits, so the flag works even where onStartup does not fire.
 */
let sessionCheck = null;
function backupLastSession() {
  if (!sessionCheck) {
    sessionCheck = (async () => {
      const store = api.storage.session;
      if (store) {
        const { booted } = await store.get('booted');
        if (booted) return;
        await store.set({ booted: true });
      }
      const { live } = await api.storage.local.get('live');
      if (live && live.windows && live.windows.length) await TS.addBackup(live.windows, 'startup');
    })().catch(() => {});
  }
  return sessionCheck;
}
api.runtime.onStartup.addListener(async () => {
  await backupLastSession();
  await ensureAlarm();
  scheduleLive();
});

api.alarms.onAlarm.addListener(a => {
  if (a.name === ALARM) TS.backupNow('auto').catch(() => {});
});

api.tabs.onCreated.addListener(scheduleLive);
api.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === 'complete' || info.pinned !== undefined || info.groupId !== undefined) scheduleLive(); });
api.tabs.onMoved.addListener(scheduleLive);
api.tabs.onAttached.addListener(scheduleLive);
api.tabs.onRemoved.addListener((id, info) => { if (!info.isWindowClosing) scheduleLive(); });
if (api.tabs.onDetached) api.tabs.onDetached.addListener(scheduleLive);
if (api.tabGroups && api.tabGroups.onUpdated) {
  api.tabGroups.onUpdated.addListener(scheduleLive);
  api.tabGroups.onCreated.addListener(scheduleLive);
  api.tabGroups.onRemoved.addListener(scheduleLive);
}
if (api.windows.onBoundsChanged) api.windows.onBoundsChanged.addListener(scheduleLive);

api.windows.onRemoved.addListener(async () => {
  clearTimeout(liveTimer);
  const { live } = await api.storage.local.get('live');
  if (live && live.windows && live.windows.length) await TS.addBackup(live.windows, 'windowClosed');
  await refreshLive();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) ensureAlarm();
});

api.commands.onCommand.addListener(cmd => {
  if (cmd === 'save-session') TS.saveSession('').catch(() => {});
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'backupNow') {
    TS.backupNow('manual').then(b => sendResponse({ ok: true, created: !!b }), () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

ensureAlarm();
backupLastSession();
