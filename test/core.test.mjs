import assert from 'node:assert/strict';
import test from 'node:test';
import { callsNamed, createFakeBrowser, loadTabmoor, win } from './harness.mjs';

function setup(opts) {
  const fake = createFakeBrowser();
  const ctx = loadTabmoor(fake, opts);
  return { fake, TS: ctx.TS };
}

test('free tier keeps 10 rolling backups and unlimited sessions', async () => {
  const { fake, TS } = setup();
  assert.equal(TS.LIMITS.free.backups, 10);
  assert.equal(TS.LIMITS.pro.backups, 50);
  assert.equal((await TS.getSettings()).pro, false);

  fake.state.windows = [{
    id: 1, incognito: false, focused: true, state: 'normal', width: 800, height: 600,
    tabs: [{ id: 2, url: 'https://example.com/a', title: 'A', pinned: false, active: true, groupId: -1 }],
  }];
  for (let i = 0; i < 12; i++) {
    fake.state.windows[0].tabs[0].url = 'https://example.com/s' + i;
    const saved = await TS.saveSession('S' + i);
    assert.ok(saved);
  }
  assert.equal((await TS.listSessions()).length, 12);

  for (let i = 0; i < 12; i++) {
    const made = await TS.addBackup(win('https://example.com/b' + i), 'auto');
    assert.ok(made);
  }
  const backups = await TS.listBackups();
  assert.equal(backups.length, 10);
  assert.equal(backups[0].windows[0].tabs[0].url, 'https://example.com/b11');
  assert.equal(await TS.addBackup(win('https://example.com/b11'), 'auto'), null);
});

test('pro keeps 50 rolling backups plus one per day for 30 days', async () => {
  const { TS } = setup();
  const now = new Date();
  now.setHours(15, 0, 0, 0);
  const today = now.getTime();
  const at = days => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d.getTime();
  };
  assert.equal(TS.daysAgo(at(29), today), 29);
  assert.equal(TS.daysAgo(at(30), today), 30);

  const list = [];
  for (let i = 0; i < 50; i++) {
    list.push({ id: 't' + i, created: today - i * 1000, reason: 'auto', fp: 't' + i, windows: win('https://example.com/t' + i) });
  }
  list.push({ id: 'd29', created: at(29), reason: 'auto', fp: 'd29', windows: win('https://example.com/d29') });
  list.push({ id: 'd30', created: at(30), reason: 'auto', fp: 'd30', windows: win('https://example.com/d30') });
  const pro = TS.applyRetention(list, { pro: true, now: today });
  assert.equal(pro.length, 51);
  assert.ok(pro.some(b => b.id === 'd29'));
  assert.equal(pro.some(b => b.id === 'd30'), false);

  const free = TS.applyRetention(list, { pro: false, now: today });
  assert.equal(free.length, 10);
  assert.equal(free.some(b => b.id === 'd29'), false);

  const sparse = [];
  for (let day = 0; day < 40; day++) {
    sparse.push({ id: 's' + day, created: at(day), reason: 'auto', fp: 's' + day, windows: win('https://example.com/s' + day) });
  }
  const underRolling = TS.applyRetention(sparse, { pro: true, now: today });
  assert.equal(underRolling.length, 40);
});

test('turning Pro off drops daily history and trims to 10', async () => {
  const { TS } = setup();
  await TS.setSettings({ pro: true });
  for (let i = 0; i < 12; i++) await TS.addBackup(win('https://example.com/p' + i), 'auto');
  assert.equal((await TS.listBackups()).length, 12);
  await TS.setSettings({ pro: false });
  const kept = await TS.enforceBackupLimit();
  assert.equal(kept.length, 10);
});

test('tags and folders can be edited only when Pro is on, and import keeps them', async () => {
  const { TS } = setup();
  const windows = win('https://example.com/keep');
  const added = await TS.importData({
    app: 'tabmoor',
    sessions: [{ name: 'Imported', tags: ['Work', 'work', '  '], folder: '  Proj  ', windows }],
  });
  assert.equal(added, 1);
  let [session] = await TS.listSessions();
  assert.deepEqual(session.tags, ['Work']);
  assert.equal(session.folder, 'Proj');
  assert.equal(await TS.updateSession(session.id, { folder: 'Nope', tags: ['x'] }), false);
  [session] = await TS.listSessions();
  assert.equal(session.folder, 'Proj');

  await TS.setSettings({ pro: true });
  assert.equal(await TS.updateSession(session.id, { folder: '', tags: 'alpha, beta, alpha' }), true);
  [session] = await TS.listSessions();
  assert.equal(session.folder, undefined);
  assert.deepEqual(session.tags, ['alpha', 'beta']);

  const exported = await TS.exportData();
  assert.equal(exported.app, 'tabmoor');
  assert.equal(exported.format, 1);
  assert.deepEqual(exported.sessions[0].tags, ['alpha', 'beta']);
});

test('export does not include the license record', async () => {
  const { fake, TS } = setup();
  await fake.api.storage.local.set({ license: { key: 'SECRET-KEY', instanceId: 'inst', activatedAt: 1 } });
  await TS.importData({ app: 'tabmoor', sessions: [{ name: 'A', windows: win('https://example.com/a') }] });
  const dumped = JSON.stringify(await TS.exportData());
  assert.equal(dumped.includes('SECRET-KEY'), false);
  assert.equal(dumped.includes('inst'), false);
});

test('lazy restore discards inactive tabs on Chrome and creates discarded tabs on Firefox', async () => {
  const chrome = setup();
  await chrome.TS.setSettings({ pro: true });
  const windows = [{
    state: 'normal', width: 800, height: 600,
    tabs: [
      { url: 'https://example.com/one', title: 'One', pinned: false, active: false },
      { url: 'https://example.com/two', title: 'Two', pinned: false, active: true },
    ],
  }];
  await chrome.TS.restore(windows, { lazy: true });
  const created = callsNamed(chrome.fake, 'tabs.create').map(c => c.detail);
  assert.equal(created.length, 2);
  assert.equal(created.every(p => p.discarded === undefined), true);
  const discarded = callsNamed(chrome.fake, 'tabs.discard');
  assert.equal(discarded.length, 1);

  const free = setup();
  await free.TS.restore(windows, { lazy: true });
  assert.equal(callsNamed(free.fake, 'tabs.discard').length, 0);

  const ff = setup({ firefox: true });
  await ff.TS.setSettings({ pro: true });
  await ff.TS.restore(windows, { lazy: true });
  const ffCreated = callsNamed(ff.fake, 'tabs.create').map(c => c.detail);
  assert.equal(ffCreated[0].discarded, true);
  assert.equal(ffCreated[0].title, 'One');
  assert.equal(ffCreated[1].discarded, undefined);
  assert.equal(callsNamed(ff.fake, 'tabs.discard').length, 0);
});

test('restore passes normal window bounds and not bounds for a maximized window', async () => {
  const { fake, TS } = setup();
  await TS.restore([{
    state: 'normal', left: 30, top: 40, width: 640, height: 480,
    tabs: [{ url: 'https://example.com/', title: 'E', pinned: false, active: true }],
  }]);
  const normal = callsNamed(fake, 'windows.create')[0].detail;
  assert.equal(normal.left, 30);
  assert.equal(normal.top, 40);
  assert.equal(normal.width, 640);
  assert.equal(normal.height, 480);

  const again = setup();
  await again.TS.restore([{
    state: 'maximized', left: 1, top: 2, width: 900, height: 700,
    tabs: [{ url: 'https://example.com/', title: 'E', pinned: false, active: true }],
  }]);
  const max = callsNamed(again.fake, 'windows.create')[0].detail;
  assert.equal(max.width, undefined);
  assert.equal(max.height, undefined);
  assert.equal(max.left, undefined);
  const updated = callsNamed(again.fake, 'windows.update')[0].detail;
  assert.equal(updated.props.state, 'maximized');
});

test('snapshot skips private windows, new tabs and extension pages', async () => {
  const { fake, TS } = setup();
  fake.state.windows = [
    { id: 1, incognito: true, focused: false, state: 'normal', tabs: [{ url: 'https://example.com/secret', title: 'S' }] },
    { id: 2, incognito: false, focused: true, state: 'normal', tabs: [
      { url: 'about:newtab', title: 'New' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'chrome-extension://tabmoor-test/popup.html', title: 'Self' },
      { url: 'https://example.com/ok', title: 'Ok', pinned: true, active: true, groupId: -1 },
    ] },
  ];
  const shot = await TS.snapshot();
  assert.equal(shot.length, 1);
  assert.equal(shot[0].tabs.length, 1);
  assert.equal(shot[0].tabs[0].url, 'https://example.com/ok');
  assert.equal(shot[0].tabs[0].pinned, true);
});
