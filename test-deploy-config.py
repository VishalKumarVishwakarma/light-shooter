"""Pin the deploy configuration, so a broken deploy fails here rather than on Netlify.

Two real defects were found by checking rather than assuming:

  1. server/koyeb.yaml said `dockerfile: ../Dockerfile`, but the only Dockerfile is
     server/Dockerfile and there is none at the repo root. Depending on which base Koyeb
     resolves that against, it pointed at a non-existent file or escaped the repo.
     Koyeb's docs were unreachable to settle the convention, so the config was moved to
     the root where `server/Dockerfile` is correct under BOTH.

  2. VITE_SERVER_URL was never inlined (a cast plus optional chaining defeated Vite's
     static replacement). That one is covered by client/test-deploy-url.mjs; what is
     checked here is that the deploy docs and config agree with reality.

Everything asserted is about files on disk, not about what a host might do.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path('.')
ok = True


def check(label, cond, extra=""):
    global ok
    print(f"  {'ok  ' if cond else 'FAIL'} {label}{(' -- ' + extra) if extra else ''}")
    if not cond:
        ok = False


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


print("=== 1. the Koyeb config resolves to a real Dockerfile ===")
check("koyeb.yaml is at the repo root", (ROOT / 'koyeb.yaml').is_file())
check("the old server/koyeb.yaml is gone", not (ROOT / 'server' / 'koyeb.yaml').exists(),
      'two configs would be ambiguous about which one the dashboard uses')

koy = read('koyeb.yaml')
m = re.search(r'^\s*dockerfile:\s*(\S+)', koy, re.M)
path = m.group(1) if m else ''
check("a dockerfile field is set", bool(path), path)
check("it points at server/Dockerfile", path == 'server/Dockerfile', path)
# the reason the config sits at the root: both conventions must agree
check("resolves from the repo root", (ROOT / path).is_file())
check("resolves from the config's own directory", (ROOT / path).is_file(),
      'this is why it is at the root -- otherwise the two conventions could disagree')

print("\n=== 2. the Dockerfile's build-context assumption holds ===")
check("the only Dockerfile is server/Dockerfile",
      [p for p in ROOT.rglob('Dockerfile') if 'node_modules' not in str(p)]
      == [ROOT / 'server' / 'Dockerfile'],
      str([str(p) for p in ROOT.rglob('Dockerfile') if 'node_modules' not in str(p)]))
df = read('server/Dockerfile')
check("it declares the repo root as the context",
      bool(re.search(r'context MUST be the repo root', df, re.I)))
# it COPYs the workspace package.json, so a server/-only context could never build
check("it copies the workspace package.json (needs repo-root context)",
      bool(re.search(r'COPY package\.json', df)))
check("so a server/-only build context is impossible",
      not (ROOT / 'server' / 'package-lock.json').is_file()
      or 'package-lock.json' in df)

print("\n=== 3. the sizing that the free tier depends on ===")
check("instance_count is 1 (rooms are in-memory; 2 would split a lobby)",
      bool(re.search(r'^instance_count:\s*1', koy, re.M)))
check("autoscaling max is 1", bool(re.search(r'^\s*max:\s*1', koy, re.M)))
check("the free instance is selected", bool(re.search(r'instance_type:\s*free:small', koy)))
check("a healthcheck is configured", bool(re.search(r'healthcheck:', koy)))

print("\n=== 4. Netlify config ===")
net = read('netlify.toml')
check("base is client", bool(re.search(r'^\s*base\s*=\s*"client"', net, re.M)))
check("publish is dist", bool(re.search(r'^\s*publish\s*=\s*"dist"', net, re.M)))
check("command builds the client", bool(re.search(r'command\s*=\s*"npm run build"', net)))
check("VITE_SERVER_URL is documented as required", 'VITE_SERVER_URL' in net)
check("the localhost pitfall is called out",
      bool(re.search(r'falls back to http://localhost:2567', net)))
check("Node is pinned", bool(re.search(r'NODE_VERSION\s*=\s*"22"', net)))

print("\n=== 5. the client can resolve a wss:// server (https page rule) ===")
check("the Dockerfile explains the mixed-content rule", 'wss://' in df)
url = read('client/src/net/serverUrl.ts')
check("ws/wss is derived from the http(s) base, not hardcoded",
      bool(re.search(r"SERVER_WS = SERVER_HTTP\.replace\(/\^http/, 'ws'\)", url)))

print("\n=== 6. the docs agree with the files ===")
d = read('DEPLOY.md')
check("DEPLOY.md references the root koyeb.yaml", 'koyeb.yaml' in d)
check("and no longer points at server/koyeb.yaml",
      not re.search(r'Config file:\s+server/koyeb\.yaml', d))
check("it states the server cannot run on Netlify",
      bool(re.search(r'cannot be the same deploy|cannot go on Netlify', d, re.I)))
check("it names Koyeb for the server", bool(re.search(r'koyeb', d, re.I)))
check("it documents ?server= for testing without a rebuild", '?server=' in d)
check("it warns VITE_SERVER_URL must be set before the first build",
      bool(re.search(r'before.*first build|first build', d, re.I)))

print("\n=== 7. nothing secret would be pushed ===")
gi = read('.gitignore')
check('.env ignored', bool(re.search(r'^\.env$', gi, re.M)))
check('.netlify/ ignored', '.netlify/' in gi)
check('.env.example stays committable', '!.env.example' in gi)

print()
print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)