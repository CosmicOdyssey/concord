#!/usr/bin/env python3
"""Measure an owned isolated local process, without stopping any existing server."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
ROOT = Path(__file__).resolve().parents[1]
# Separate non-default port; bind failure is a failure, never permission to kill its owner.
PORT = 18081
with tempfile.TemporaryDirectory() as data, tempfile.TemporaryFile() as log:
    env = {k:os.environ[k] for k in ('PATH','LANG','LC_ALL') if k in os.environ}
    env['CONCORD_DATA_DIR'] = data
    started = time.perf_counter()
    p = subprocess.Popen([str(ROOT/'backend/.venv/bin/python'),'-m','uvicorn','concord.api.demo:app','--host','127.0.0.1','--port',str(PORT)],cwd=ROOT/'backend',env=env,stdout=log,stderr=log)
    try:
        while True:
            if p.poll() is not None: raise RuntimeError('Owned server failed to bind/start')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/hackharvard-demo',timeout=.5) as r:
                    result=json.load(r)
                break
            except (OSError,TimeoutError):
                if time.perf_counter()-started>15: raise RuntimeError('Startup exceeded 15 seconds')
                time.sleep(.05)
        print(json.dumps({'scope':'Fresh owned uvicorn process through first successful baseline HTTP response; dependencies/build already installed','startup_ms':round((time.perf_counter()-started)*1000,3),'baseline_compute_ms':result['baseline_compute_ms'],'port':PORT,'pid':p.pid,'external_credentials_forwarded':False}))
    finally:
        if p.poll() is None:
            p.terminate()
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:p.kill();p.wait()
