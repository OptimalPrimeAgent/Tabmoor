/* Lemon Squeezy ids for Tabmoor Pro. No API secret belongs in this file. */
(function (g) {
  'use strict';

  // The store is not created yet. These placeholders are intentional.
  // After the store is Approved and the product exists, replace:
  //   LEMON_STORE_ID    with the numeric store id (response meta.store_id)
  //   LEMON_PRODUCT_ID  with the numeric product id (response meta.product_id)
  //   LEMON_CHECKOUT_URL with the product's https checkout link
  // Leave LEMON_CHECKOUT_URL empty until then. Do not invent a checkout URL.
  // Activation does nothing until the two ids are no longer these placeholders,
  // and then it accepts a key only when both ids match the response.
  const LEMON_STORE_ID = 'LEMON_STORE_ID';
  const LEMON_PRODUCT_ID = 'LEMON_PRODUCT_ID';
  const LEMON_CHECKOUT_URL = ''; // TODO: https checkout URL after the product exists.

  g.TABMOOR_LEMON = {
    STORE_ID: LEMON_STORE_ID,
    PRODUCT_ID: LEMON_PRODUCT_ID,
    CHECKOUT_URL: LEMON_CHECKOUT_URL,
    ORIGIN: 'https://api.lemonsqueezy.com/*',
    ACTIVATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/activate',
    DEACTIVATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/deactivate',
  };
})(globalThis);
