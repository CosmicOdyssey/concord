#!/usr/bin/env python3
"""Serve the built demo + existing API on loopback. No deployment or external APIs.

Setup first: uv venv backend/.venv; uv pip install --python backend/.venv/bin/python
+-r backend/requirements.txt; cd frontend && npm ci && npm run build.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18080)
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('Use an unprivileged port between 1024 and 65535')
python = ROOT/'backend/.venv/bin/python'
if not python.is_file() or not (ROOT/'frontend/dist/index.html').is_file():
    sys.exit('Install backend dependencies and build the frontend first. See docs/demo/README.md.')
data = ROOT/'.fleet/state/hackharvard-demo-data'
data.mkdir(parents=True, exist_ok=True)
# Dedicated empty ratecard/SQLite namespace. No production credentials forwarded.
env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT') if k in os.environ}
env['CONCORD_DATA_DIR'] = str(data)
print(f'Concord local demo: http://127.0.0.1:{args.port}/#demo\nCtrl-C stops only this owned server.', flush=True)
p = subprocess.Popen([str(python), '-m', 'uvicorn', 'concord.api.demo:app', '--host', '127.0.0.1', '--port', str(args.port)], cwd=ROOT/'backend', env=env)
try:
    sys.exit(p.wait())
except KeyboardInterrupt:
    pass
finally:
    if p.poll() is None:
        p.terminate()
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill(); p.wait()
