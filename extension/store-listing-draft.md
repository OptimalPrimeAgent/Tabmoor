# Tabmoor 0.3.0 store text

Support contact: ptd.fullstack@gmail.com

## What changed in the listing

Replace "makes no network requests" / "foretager ingen netværkskald" with: the extension makes no network requests except when you unlock Pro or deactivate it on this browser.

Pro is 99 DKK incl. VAT, one-time, lifetime, up to 3 browsers. Payment is handled by Stripe (via Link), who is the merchant of record. Free stays unlimited sessions and the 10 most recent automatic backups.

Buy link: https://buy.stripe.com/fZu9AV0JDaBy6aG1v118c00
After payment the buyer gets an unlock code on https://tabmoor-unlock.tabmoor.workers.dev/success and pastes it under Pro.

## English description, extra paragraphs

Privacy first: tabs and sessions stay on your computer. Tabmoor makes no network requests, except when you unlock Pro or deactivate it on this browser. No ads, no tracking and no account. Private windows are never saved.

Tabmoor Pro is a one-time purchase of 99 DKK incl. VAT (lifetime, up to 3 browsers). It keeps 50 rolling automatic backups, tags and folders, lazy tab restore, and one backup per day for 30 days. Payment is handled by Stripe. After checkout you get an unlock code. Open Tabmoor, choose Pro, and enter the code. It works on up to 3 browsers. Support: ptd.fullstack@gmail.com

## Dansk beskrivelse, ekstra afsnit

Privatliv først: faner og sessioner bliver på din computer. Tabmoor foretager ingen netværkskald, undtagen når du låser Pro op eller deaktiverer det på denne browser. Ingen annoncer, ingen sporing og ingen konto. Private vinduer gemmes aldrig.

Tabmoor Pro er et engangskøb på 99 kr. inkl. moms (livstid, op til 3 browsere). Det giver 50 rullende automatiske backups, mærker og mapper, faner, der først indlæses, når du klikker på dem, og én backup pr. dag i 30 dage. Betaling klares af Stripe. Når du har betalt, får du en oplåsningskode. Åbn Tabmoor, vælg Pro, og indsæt koden. Den virker på op til 3 browsere. Support: ptd.fullstack@gmail.com

## Before submission (not done here)

- Chrome Web Store data use: still Web history (stored locally). Also consider Authentication information, because the unlock code is sent to the Tabmoor unlock service when the user chooses Unlock or Deactivate. Confirm before ticking.
- Edge privacy page: same disclosure. Remote code: no. Payment is handled by Stripe.
- Firefox AMO: `data_collection_permissions` is `required: ["none"]` and `optional: ["authenticationInfo"]`, because the free extension transmits nothing and the unlock code is sent only after the user asks to unlock or deactivate. "Requires payment": leave as no, the free tier works without paying. Confirm both against Mozilla's form before submit.
- Seller shown to buyers: Patrick, based in Denmark. No home address. Support email: ptd.fullstack@gmail.com
