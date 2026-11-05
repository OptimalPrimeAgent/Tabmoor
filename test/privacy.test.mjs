import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { rootDir } from './harness.mjs';

test('privacy draft discloses the optional Lemon Squeezy call and nothing else', () => {
  const html = fs.readFileSync(path.join(rootDir, 'privacy/index.html'), 'utf8');
  assert.match(html, /Patrick must approve this privacy text before it is published/);
  assert.match(html, /api\.lemonsqueezy\.com/);
  assert.match(html, /merchant of record/i);
  assert.match(html, /customer/i);
  assert.doesNotMatch(html, /foretager ingen netværkskald/);
  assert.doesNotMatch(html, /makes no network requests/);
  assert.match(html, /Microsoft Edge/);
  assert.match(html, /50/);
  assert.match(html, /30/);
});
