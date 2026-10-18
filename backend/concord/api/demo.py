"""Local-only presentation entry point; same API, locally built static frontend."""
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from concord.api.main import app

DIST = Path(__file__).resolve().parents[3] / 'frontend/dist'
if not (DIST / 'index.html').is_file():
    raise RuntimeError('Build the frontend first: cd frontend && npm run build')
app.mount('/', StaticFiles(directory=DIST, html=True), name='demo-static')
