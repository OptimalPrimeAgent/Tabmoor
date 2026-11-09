import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { rootDir } from './harness.mjs';

test('privacy draft describes Stripe and the Cloudflare unlock server', () => {
  const html = fs.readFileSync(path.join(rootDir, 'privacy/index.html'), 'utf8');
  const listing = fs.readFileSync(path.join(rootDir, 'extension/store-listing-draft.md'), 'utf8');
  for (const text of [html, listing]) {
    assert.doesNotMatch(text, /lemon/i);
    assert.doesNotMatch(text, /thamsdimon/i);
    assert.match(text, /Stripe/);
    assert.match(text, /ptd\.fullstack@gmail\.com/);
  }
  assert.match(html, /DRAFT: Patrick must approve this privacy text before it is published/);
  assert.match(html, /Udkast, ikke godkendt/);
  assert.match(html, /Draft, not approved for publication/);
  assert.match(html, /merchant of record/i);
  assert.match(html, /Cloudflare/);
  assert.match(html, /tabmoor-unlock\.tabmoor\.workers\.dev/);
  assert.match(html, /Patrick, based in Denmark/);
  assert.match(html, /Patrick, bosat i Danmark/);
  assert.match(html, /No home address/);
  assert.match(html, /about 1 hour|ca\. 1 time/);
  assert.match(listing, /Payment is handled by Stripe|Betaling klares af Stripe/);
});
