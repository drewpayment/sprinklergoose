"""File-backed zone name store with atomic-ish writes."""

import json
import os
import tempfile
from pathlib import Path


class ZoneNameStore:
    """Persists user-assigned zone names to a JSON file.

    Unnamed zones fall back to "Zone N". The file is created on demand and
    written via a temp file + os.replace so a crash never leaves it truncated.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._names: dict[int, str] = self._load()

    def _load(self) -> dict[int, str]:
        try:
            raw = json.loads(self._path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        return {int(k): str(v) for k, v in raw.items()}

    def get(self, zone_id: int) -> str:
        return self._names.get(zone_id, f"Zone {zone_id}")

    def set(self, zone_id: int, name: str) -> None:
        self._names[zone_id] = name
        self._save()

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump({str(k): v for k, v in self._names.items()}, f, indent=2)
            os.replace(tmp, self._path)
        except BaseException:
            os.unlink(tmp)
            raise
