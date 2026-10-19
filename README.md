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
| `db/mlicanada_shop.sql.gz` | the catalogue database, **person-free and secret-free** |
| `functions/` | the Pages Functions the live site runs |
| `scripts/` | the export pipeline |
| R2 `mlicanada-admin/overlay.part*` | theme, modules and product images (383 MB) — **not in this repo**: the theme and modules are commercial, so they sit in a private bucket and the workflow needs `CLOUDFLARE_API_TOKEN` to fetch them |

### The database here holds no personal data and no credentials
336 tables. Customers, addresses, orders, carts, messages, newsletter
subscriptions, employees and webservice accounts are **structure-only — zero
rows**; everything the catalogue needs has its data. The 480 customer records
and 5 orders stay on the origin.

`ps_configuration` is regenerated with credential values blanked, because the
live shop keeps its SMTP password, an RSA private key and a live payment secret
in that table. 12 values are emptied; the rows remain so PrestaShop still
boots. Verified on export: no private keys, no provider secrets.

The save-back step re-applies both rules, so an admin session cannot push
personal data or credentials into this repo. The workflow seeds exactly one
admin account at boot and never writes employee rows back.

Because those values are blank, anything that needs them is inert in the
runner — outbound shop mail and payment modules will not work there. That is
deliberate: this copy exists to edit the catalogue.

## Why it is built this way

* **Pristine core.** The runner downloads the official PrestaShop 1.7.7.5 image
  and overlays only the theme, modules and images. The origin's own PHP tree is
  21,429 files with a history of compromise and cannot be certified clean, so
  none of it is carried over. The overlay is scanned before upload (8,312
  images checked for PHP payloads, 0 found).
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
