#!/usr/bin/env python3
"""Deploy firestore.rules to Firebase using the service account key."""
import json, time, base64, urllib.request, urllib.parse, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
KEY_FILE = ROOT / "service-account.json"
RULES_FILE = ROOT / "firestore.rules"

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

key_data = json.loads(KEY_FILE.read_text())
private_key = serialization.load_pem_private_key(key_data["private_key"].encode(), password=None, backend=default_backend())
project = key_data["project_id"]

now = int(time.time())
header = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({
    "iss": key_data["client_email"],
    "scope": "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase",
    "aud": "https://oauth2.googleapis.com/token",
    "exp": now + 3600,
    "iat": now
}).encode()).rstrip(b"=").decode()

sig = base64.urlsafe_b64encode(
    private_key.sign(f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
).rstrip(b"=").decode()

jwt = f"{header}.{payload}.{sig}"
data = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt}).encode()
token = json.loads(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data)).read())["access_token"]

def api(url, body=None, method=None):
    req = urllib.request.Request(
        url, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method
    )
    return json.loads(urllib.request.urlopen(req).read())

ruleset = api(
    f"https://firebaserules.googleapis.com/v1/projects/{project}/rulesets",
    json.dumps({"source": {"files": [{"name": "firestore.rules", "content": RULES_FILE.read_text()}]}}).encode()
)
ruleset_name = ruleset["name"]
print(f"Ruleset created: {ruleset_name}")

release_name = f"projects/{project}/releases/cloud.firestore"
result = api(
    f"https://firebaserules.googleapis.com/v1/{release_name}",
    json.dumps({"release": {"name": release_name, "rulesetName": ruleset_name}}).encode(),
    method="PATCH"
)
print(f"Rules deployed: {result.get('rulesetName')}")
