from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
frontend = root / "frontend"
backend = root / "backend"
frontend.mkdir(exist_ok=True)
backend.mkdir(exist_ok=True)

for name in ["index.html", "styles.css", "app.js"]:
    src = root / name
    if src.exists():
        shutil.move(str(src), str(frontend / name))

static_src = root / "static"
if static_src.exists():
    shutil.move(str(static_src), str(frontend / "static"))

for name in ["main.py", "requirements.txt"]:
    src = root / name
    if src.exists():
        shutil.move(str(src), str(backend / name))

for name in [".venv", "venv"]:
    src = root / name
    if src.exists():
        shutil.move(str(src), str(backend / name))

for path in list(root.iterdir()):
    if path.name in {".env", ".gitignore"}:
        continue

    if path.is_file():
        low = path.name.lower()
        if low.endswith((".md", ".markdown")):
            path.unlink(missing_ok=True)
        elif any(marker in low for marker in ["test_feedback", "test_run_id", "redesign_summary"]) or low.endswith(".log") or low.endswith(".txt"):
            path.unlink(missing_ok=True)
        elif low.endswith((".db", ".sqlite", ".sqlite3")):
            shutil.move(str(path), str(backend / path.name))
    elif path.is_dir():
        low = path.name.lower()
        if low in {"frontend", "backend"}:
            continue
        if any(marker in low for marker in ["test_feedback", "test_run_id", "redesign_summary"]) or low.endswith(".log"):
            shutil.rmtree(path, ignore_errors=True)