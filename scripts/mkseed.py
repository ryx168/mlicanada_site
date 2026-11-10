"""Emit the ps_employee seed SQL for an admin session.

Reads the staff list as JSON from the MLI_STAFF environment variable (a GitHub
secret) and writes INSERT statements to stdout.

WHY A SECRET AND NOT THE REPO: this repo is PUBLIC - private Actions are
billing-blocked on this account, so it has to be, or the admin cannot run at
all. The staff list carries names, email addresses and bcrypt password hashes.
None of that may be committed. The catalogue dump is taken with
--ignore-table=jinwu_shop.ps_employee for exactly the same reason, which is why
the admin had only the two accounts this script replaces.

WHY THE OLD HASHES WORK: PrestaShop 1.7 hashes employee passwords with bcrypt,
which does not depend on the shop's cookie key or on anything else in
parameters.php. A hash lifted from the old server therefore still verifies on a
fresh container, so staff keep the password they already know.

ADMIN_PASSWORD, when set, overrides the hash for OVERRIDE_EMAIL only. The owner
has been signing in with that secret since October; restoring his January hash
would silently swap his password for one he may no longer remember, and with
every other account also on its old password there would be no way back in.
Everyone else gets their original password untouched.

Usage: MLI_STAFF='[...]' python3 scripts/mkseed.py [override_bcrypt_hash]
"""
import json
import os
import sys

OVERRIDE_EMAIL = "harry@superesolutions.com"

# NOT NULL columns PrestaShop 1.7.7 needs but the backup rows do not carry.
DEFAULTS = {
    "optin": "0",
    "default_tab": "1",
    "bo_theme": "default",
    "bo_menu": "1",
    "stats_date_from": "2026-01-01",
    "stats_date_to": "2026-12-31",
}


def q(v):
    """Quote a value for MySQL."""
    s = "" if v is None else str(v)
    s = s.replace(chr(92), chr(92) * 2)
    s = s.replace("'", chr(92) + "'")
    return "'" + s + "'"


raw = os.environ.get("MLI_STAFF", "").strip()
if not raw:
    sys.stderr.write("MLI_STAFF is empty\n")
    raise SystemExit(2)

try:
    staff = json.loads(raw)
except Exception as exc:
    sys.stderr.write("MLI_STAFF is not valid JSON: %s\n" % exc)
    raise SystemExit(2)

if not isinstance(staff, list) or not staff:
    sys.stderr.write("MLI_STAFF must be a non-empty JSON array\n")
    raise SystemExit(2)

override = sys.argv[1] if len(sys.argv) > 1 else ""

cols = ["id_employee", "id_profile", "id_lang", "lastname", "firstname",
        "email", "passwd", "active", "optin", "default_tab", "bo_theme",
        "bo_menu", "stats_date_from", "stats_date_to"]

print("DELETE FROM ps_employee;")

seeded = 0
for p in staff:
    email = str(p.get("email", "")).strip()
    pw = str(p.get("passwd", ""))
    if not email or not pw:
        sys.stderr.write("skipping an entry with no email or no hash\n")
        continue
    # Refuse anything that is not a bcrypt hash rather than seeding an account
    # nobody can sign in to.
    if not pw.startswith("$2"):
        sys.stderr.write("skipping %s: password is not a bcrypt hash\n" % email)
        continue
    if override and email.lower() == OVERRIDE_EMAIL:
        pw = override
    vals = [
        p.get("id_employee"), p.get("id_profile", 1), p.get("id_lang", 1),
        p.get("lastname", ""), p.get("firstname", ""), email, pw,
        p.get("active", "1"),
        DEFAULTS["optin"], DEFAULTS["default_tab"], DEFAULTS["bo_theme"],
        DEFAULTS["bo_menu"], DEFAULTS["stats_date_from"],
        DEFAULTS["stats_date_to"],
    ]
    print("INSERT INTO ps_employee (%s) VALUES (%s);"
          % (",".join(cols), ",".join(q(v) for v in vals)))
    seeded += 1

if not seeded:
    sys.stderr.write("no usable staff rows\n")
    raise SystemExit(2)

# 1.7.7 keeps the shop association in ps_employee_shop; ps_employee itself has
# no id_shop column, and naming one makes the seed fail with no way to log in.
print("DELETE FROM ps_employee_shop;")
print("INSERT INTO ps_employee_shop (id_employee,id_shop) "
      "SELECT id_employee,1 FROM ps_employee;")

sys.stderr.write("seeded %d employee rows\n" % seeded)
