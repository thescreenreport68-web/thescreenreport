# SOURCE-OUTLET IMAGE FETCH (curl_cffi Chrome impersonation — Valnet/Dotdash 403 plain fetchers).
# Usage: og_fetch.py --url <page> → JSON list of og/twitter image URLs
import argparse, json, re
p = argparse.ArgumentParser(); p.add_argument("--url", required=True); a = p.parse_args()
try:
    from curl_cffi import requests
    r = requests.get(a.url, impersonate="chrome", timeout=15)
    html = r.text if r.status_code == 200 else ""
except Exception:
    html = ""
urls = re.findall(r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)[^"\']*["\'][^>]+content=["\']([^"\']+)["\']', html)
urls += re.findall(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)', html)
print(json.dumps(list(dict.fromkeys([u for u in urls if u.startswith("http")]))[:4]))
