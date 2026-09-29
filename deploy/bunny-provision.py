#!/usr/bin/env python3
"""Idempotently provision Bunny.net storage + CDN for Murmur.
Usage: BUNNY_API_KEY=... deploy/bunny-provision.py <zone-name> [storage-region]
Prints the env vars the server needs. Never commit the account API key."""
import json, os, sys, urllib.request

API = "https://api.bunny.net"
KEY = os.environ.get("BUNNY_API_KEY") or sys.exit("BUNNY_API_KEY not set")
if len(sys.argv) < 2: sys.exit("usage: BUNNY_API_KEY=... deploy/bunny-provision.py <zone-name> [storage-region]")
NAME = sys.argv[1]
REGION = sys.argv[2] if len(sys.argv) > 2 else "NY"

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"AccessKey": KEY, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read().decode()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:300]
        if "insufficient_balance" in msg:
            sys.exit("Bunny refused: the account needs credit or a verified payment method before zones can be created (Dashboard → Billing). Then rerun this script.")
        sys.exit(f"{method} {path} -> {e.code}: {msg}")

# --- storage zone ---
zones = call("GET", "/storagezone?page=1&perPage=100")
items = zones.get("Items", zones) if isinstance(zones, dict) else zones
sz = next((z for z in items if z["Name"] == NAME), None)
if sz:
    print(f"storage zone '{NAME}' exists (id {sz['Id']}, region {sz.get('Region')})", file=sys.stderr)
else:
    sz = call("POST", "/storagezone", {"Name": NAME, "Region": REGION, "ZoneTier": 0})
    print(f"created storage zone '{NAME}' (id {sz['Id']}, region {sz.get('Region')})", file=sys.stderr)
sz = call("GET", f"/storagezone/{sz['Id']}")  # full record incl. Password + StorageHostname

# --- pull zone linked to the storage zone ---
pz_list = call("GET", "/pullzone?page=1&perPage=100")
pz_items = pz_list.get("Items", pz_list) if isinstance(pz_list, dict) else pz_list
pz = next((p for p in pz_items if p["Name"] == NAME), None)
if pz:
    print(f"pull zone '{NAME}' exists (id {pz['Id']})", file=sys.stderr)
else:
    pz = call("POST", "/pullzone", {"Name": NAME, "StorageZoneId": sz["Id"], "Type": 0})
    print(f"created pull zone '{NAME}' (id {pz['Id']})", file=sys.stderr)

# Token auth on, cheap regions only (everything served from EU/NA at $0.01/GB), long cache
call("POST", f"/pullzone/{pz['Id']}", {
    "ZoneSecurityEnabled": True,
    "ZoneSecurityIncludeHashRemoteIP": False,
    "EnableGeoZoneUS": True, "EnableGeoZoneEU": True,
    "EnableGeoZoneASIA": False, "EnableGeoZoneSA": False, "EnableGeoZoneAF": False,
    "CacheControlMaxAgeOverride": 31919000,
    "CacheControlPublicMaxAgeOverride": 31919000,
    "DisableCookies": True,
    "IgnoreQueryStrings": True,
    "EnableTLS1": False, "EnableTLS1_1": False,
    "AddCanonicalHeader": False,
})
pz = call("GET", f"/pullzone/{pz['Id']}")
cdn_host = next((h["Value"] for h in pz.get("Hostnames", []) if h.get("IsSystemHostname")), f"{NAME}.b-cdn.net")

print("\n# add these to /etc/murmur/env (server) or .env (local):")
print(f"BUNNY_STORAGE_ZONE={sz['Name']}")
print(f"BUNNY_STORAGE_HOST={sz['StorageHostname']}")
print(f"BUNNY_STORAGE_KEY={sz['Password']}")
print(f"BUNNY_CDN_HOST={cdn_host}")
print(f"BUNNY_TOKEN_KEY={pz['ZoneSecurityKey']}")
