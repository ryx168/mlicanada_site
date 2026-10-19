# mlicanada.com — on-demand admin + static republish

The public site is a **static export on Cloudflare Pages** (project
`mlicanada-holding`). There is no PHP, no login and no checkout facing the
internet. When the catalogue needs editing, this repo boots the real
PrestaShop admin in a throwaway GitHub Actions runner, hands you a temporary
https URL, and rebuilds and redeploys the static site from that same
PrestaShop when you close it.

## Using it

Actions → **mlicanada admin (on demand)** → *Run workflow*.
The run summary shows the shop URL, the admin URL and the login.

| input | meaning |
|---|---|
| `minutes` | how long to hold the admin open (max 300) |
| `republish` | rebuild and deploy the static site when the admin closes |

Cancelling the run from the Actions UI kills the job immediately, so the save
and republish steps are skipped. Let it close on its own, or set a short
`minutes`.

## Secrets to set

| secret | needed for |
|---|---|
| `ADMIN_PASSWORD` | the PrestaShop login. If unset, a random one is generated and printed in the run log. |
| `CLOUDFLARE_API_TOKEN` | republish (Pages: Edit, D1: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | republish |

Without `CLOUDFLARE_API_TOKEN` the admin still works; only the deploy is skipped.

## What is in here

| path | what |
|---|---|
| `db/mlicanada_shop.sql.gz` | the catalogue database, **person-free** |
| `functions/` | the Pages Functions the live site runs |
| `scripts/` | the export pipeline |
| release `assets` → `mlicanada_overlay.tgz` | theme, modules and product images (383 MB, kept out of git history) |

### The database here holds no personal data
336 tables. Customers, addresses, orders, carts, messages, newsletter
subscriptions and employees are **structure-only — zero rows**; everything the
catalogue needs has its data. Verified on export, and the save-back step
re-applies the same rule so an admin session cannot leak personal data into the
repo. The 480 customer records and 5 orders stay on server1.

The workflow seeds exactly one admin account at boot and never writes employee
rows back.

## Why it is built this way

* **Pristine core.** The runner downloads the official PrestaShop 1.7.7.5 image
  and overlays only the theme, modules and images. The live tree has been
  compromised twice (85 PHP-in-image webshells quarantined 2026-10-18, plus an
  unauthenticated admin-password-reset backdoor found at
  `admin168we3cgm/reset-password.php` on 2026-10-19). 21,429 PHP files cannot be
  certified clean, so none of them are carried over.
* **7.6 GB → 3.4 MB.** `ps_layered_filter_block` alone was 6.3 GB of
  regenerable facet cache, and `ps_connections`/`ps_guest` another 1.3 GB of
  visitor stats. The actual shop is 23.9 MB.
* **PHP 7.4.** PrestaShop 1.7.7.5 does not run on the PHP 8.1 that server1 now
  has — that is why the backdoor returned a 500 rather than working.
* **server1 is expiring.** With republish running inside the runner, nothing in
  this loop depends on it.

## The crawl rules that matter

* **Never crawl from the sitemap.** It lists 292 product ids that no longer
  exist and 304 URLs whose category segment is stale. Canonical URLs come from
  the shop's own 302s (`/{lang}/products/{id}-x.html` → the real URL).
* **`--max-redirect=0` always.** wget follows a redirect and saves the body
  under the *requested* path, so one stale URL silently misfiles a page.
* **A 302's Location is not proof the target exists.** Status-probe it too.
* **The export is checked before it ships.** `check-refs.py` requires every
  same-host reference to resolve; `republish.sh` aborts the deploy if it fails.
* **Cloudflare Pages 308-redirects `/path.html` to `/path`**, which would
  redirect the canonical URL of all 543 product pages.
  `functions/[lang]/_middleware.js` serves them instead.
