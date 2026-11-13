/* Tabmoor Pro: public unlock config only. No private key and no API secret. */
(function (g) {
  'use strict';
  g.TABMOOR_PRO_KEY = {
    kid: 'tabmoor-2026-11',
    jwk: { kty: 'OKP', crv: 'Ed25519', x: 'M82Nd380ykSa-Yya6OsaXvATK2iclWOvcoi2lHlf6-Q' },
  };
  g.TABMOOR_UNLOCK = {
    BUY_URL: 'https://buy.stripe.com/fZu9AV0JDaBy6aG1v118c00',
    REDEEM_URL: 'https://tabmoor-unlock.tabmoor.workers.dev/redeem',
    RELEASE_URL: 'https://tabmoor-unlock.tabmoor.workers.dev/release',
  };
})(globalThis);
