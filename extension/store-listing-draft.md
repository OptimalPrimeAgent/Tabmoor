# Tabmoor 0.3.0 store text (DRAFT)

Patrick must approve this before any store submission. Do not publish it as-is.
There is no checkout URL yet. Do not invent one. The buy link in the extension stays empty until `LEMON_CHECKOUT_URL` is set in `extension/license-config.js`.

## What changed in the listing

Replace "makes no network requests" / "foretager ingen netværkskald" with: the extension makes no network requests except one optional call to activate Pro and one to deactivate it.

Mention Pro: 99 DKK one-time, lifetime, up to 3 browsers. Free stays unlimited sessions and the 10 most recent automatic backups.

If activation starts from the toolbar popup, Tabmoor opens a tab first. Chrome and Firefox close the popup when the permission dialog appears, so the Lemon call runs from that tab.

## English description, extra paragraphs

Privacy first: tabs and sessions stay on your computer. Tabmoor makes no network requests, except one optional call when you activate Pro and one when you deactivate it. No ads, no tracking and no account. Private windows are never saved.

Tabmoor Pro is a one-time purchase of 99 DKK (lifetime, up to 3 browsers). It keeps 50 rolling automatic backups, tags and folders, lazy tab restore, and one backup per day for 30 days. Payment is handled by Lemon Squeezy, who emails the license key. Paste it under Settings → Pro.

## Dansk beskrivelse, ekstra afsnit

Privatliv først: faner og sessioner bliver på din computer. Tabmoor foretager ingen netværkskald, undtagen ét valgfrit kald når du aktiverer Pro, og ét når du deaktiverer det. Ingen annoncer, ingen sporing og ingen konto. Private vinduer gemmes aldrig.

Tabmoor Pro er et engangskøb på 99 kr. (livstid, op til 3 browsere). Det giver 50 rullende automatiske backups, mærker og mapper, gendannelse hvor faner først indlæses ved klik, og én backup pr. dag i 30 dage. Betaling klares af Lemon Squeezy, som sender licensnøglen. Den indsættes under Indstillinger → Pro.

## Before submission (not done here)

- Chrome Web Store data use: still Web history (stored locally). Also consider Authentication information, because the license key is sent to Lemon Squeezy when the user activates. Confirm before ticking.
- Edge privacy page: same disclosure. Remote code: no.
- Firefox AMO: `data_collection_permissions` is `required: ["none"]` and `optional: ["authenticationInfo"]`, because the free extension transmits nothing and the license key is sent only after the user asks to activate. "Requires payment": leave as no, the free tier works without paying. Confirm both against Mozilla's form before submit.
- Do not submit 0.3.0 until `LEMON_STORE_ID` and `LEMON_PRODUCT_ID` are the real ids. Until then Activate refuses the key and does not call Lemon Squeezy.
