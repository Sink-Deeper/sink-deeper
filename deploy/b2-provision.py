#!/usr/bin/env python3
"""One-time Backblaze B2 setup for Murmur backups, using an account-level key:
   - a private bucket, named by the first argument
   - lifecycle: db/ dumps expire after 30 days; media/ keeps overwritten/hidden versions 30 days
   - a restricted application key (list/read/write, NO delete) for the server
Usage: B2_KEY_ID=... B2_APP_KEY=... deploy/b2-provision.py <bucket-name>
Prints the env lines for /etc/murmur/backup.env. Delete the account-level key afterwards."""
import base64, json, os, sys, urllib.request

kid, sec = os.environ.get("B2_KEY_ID"), os.environ.get("B2_APP_KEY")
if not kid or not sec: sys.exit("B2_KEY_ID / B2_APP_KEY not set")
if len(sys.argv) < 2: sys.exit("usage: deploy/b2-provision.py <bucket-name>")
BUCKET = sys.argv[1]

def req(url, body=None, headers=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=headers or {}, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(r) as resp: return json.loads(resp.read())
    except urllib.error.HTTPError as e: sys.exit(f"{url} -> {e.code}: {e.read().decode()[:300]}")

auth = req("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", headers={"Authorization": "Basic " + base64.b64encode(f"{kid}:{sec}".encode()).decode()})
api, tok, acct = auth["apiInfo"]["storageApi"]["apiUrl"], auth["authorizationToken"], auth["accountId"]
H = {"Authorization": tok}

buckets = req(f"{api}/b2api/v3/b2_list_buckets", {"accountId": acct}, H)["buckets"]
b = next((x for x in buckets if x["bucketName"] == BUCKET), None)
# NOTE: a key without deleteFiles can still *hide* files (soft delete needs only writeFiles), so hidden
# versions are kept long enough to notice and recover: dumps 30 days after hiding, media 90 days.
lifecycle = [
    {"fileNamePrefix": "db/", "daysFromUploadingToHiding": 30, "daysFromHidingToDeleting": 30},
    {"fileNamePrefix": "config/", "daysFromUploadingToHiding": 30, "daysFromHidingToDeleting": 30},
    {"fileNamePrefix": "media/", "daysFromUploadingToHiding": None, "daysFromHidingToDeleting": 90},
]
if b:
    print(f"bucket {BUCKET} exists ({b['bucketId']}, {b['bucketType']})", file=sys.stderr)
    req(f"{api}/b2api/v3/b2_update_bucket", {"accountId": acct, "bucketId": b["bucketId"], "lifecycleRules": lifecycle}, H)
else:
    b = req(f"{api}/b2api/v3/b2_create_bucket", {"accountId": acct, "bucketName": BUCKET, "bucketType": "allPrivate", "lifecycleRules": lifecycle}, H)
    print(f"created private bucket {BUCKET} ({b['bucketId']})", file=sys.stderr)

if os.environ.get("B2_SKIP_KEY"): sys.exit(0)
# Restricted, non-deleting key for the server (rotate by re-running: creates a new one each time)
key = req(f"{api}/b2api/v3/b2_create_key", {
    "accountId": acct, "keyName": f"{BUCKET}-server", "bucketId": b["bucketId"],
    "capabilities": ["listBuckets", "listFiles", "readFiles", "writeFiles"],
}, H)
print("created restricted key", key["applicationKeyId"], file=sys.stderr)
print(f"B2_BUCKET={BUCKET}")
print(f"B2_KEY_ID={key['applicationKeyId']}")
print(f"B2_APP_KEY={key['applicationKey']}")
print(f"B2_S3_ENDPOINT={auth['apiInfo']['storageApi']['s3ApiUrl']}")
