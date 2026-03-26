import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List

class SnapshotManager:
    def __init__(self, skill_dir: Path):
        self.skill_dir = skill_dir.resolve()
        self.snapshots_dir = self.skill_dir / "snapshots"

    def _parse_version(self, version_str: str) -> tuple[int, int]:
        """Parse version string like 'v1' or 'v1.2' into (major, minor)."""
        match = re.match(r'^v(\d+)(?:\.(\d+))?$', version_str)
        if not match:
            return -1, -1
        major = int(match.group(1))
        minor = int(match.group(2)) if match.group(2) else 0
        return major, minor

    def get_latest_version(self) -> Optional[str]:
        """Get the latest version directory name."""
        if not self.snapshots_dir.exists():
            return None
        
        versions = []
        for d in self.snapshots_dir.iterdir():
            if d.is_dir() and d.name.startswith('v'):
                major, minor = self._parse_version(d.name)
                if major >= 0:
                    versions.append((major, minor, d.name))
        
        if not versions:
            return None
        
        versions.sort(key=lambda x: (x[0], x[1]))
        return versions[-1][2]

    def get_latest_base_version(self) -> Optional[str]:
        """Get the latest base version (minor == 0)."""
        if not self.snapshots_dir.exists():
            return None
        
        versions = []
        for d in self.snapshots_dir.iterdir():
            if d.is_dir() and d.name.startswith('v'):
                major, minor = self._parse_version(d.name)
                if major >= 0 and minor == 0:
                    versions.append((major, minor, d.name))
        
        if not versions:
            return None
        
        versions.sort(key=lambda x: x[0])
        return versions[-1][2]

    def _copy_skill_files(self, dest_dir: Path, exclude_dirs: List[str] = None):
        """Copy skill files to destination, excluding specific directories."""
        if exclude_dirs is None:
            exclude_dirs = ['snapshots', '.git', '__pycache__', 'node_modules', '.venv', 'venv', '.opt']
            
        dest_dir.mkdir(parents=True, exist_ok=True)
        for item in self.skill_dir.iterdir():
            if item.name in exclude_dirs:
                continue
            if item.is_dir():
                shutil.copytree(item, dest_dir / item.name, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest_dir / item.name)

    def create_v0_if_needed(self) -> str:
        """Create v0 snapshot if snapshots directory doesn't exist."""
        if not self.snapshots_dir.exists() or not (self.snapshots_dir / "v0").exists():
            v0_dir = self.snapshots_dir / "v0"
            self._copy_skill_files(v0_dir)
            
            meta = {
                "reason": "Initial version",
                "source": "auto",
                "mode": "init",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "base_version": None,
                "notes": []
            }
            with open(v0_dir / "meta.json", "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2, ensure_ascii=False)
            return "v0"
        return self.get_latest_base_version()

    def create_snapshot(self, mode: str, reason: str, source: str, is_feedback: bool = False) -> str:
        """Create a new snapshot directory and write meta.json.

        For v0 baseline, use create_v0_if_needed() which copies current files.
        For other snapshots, caller writes the optimized artifacts into the snapshot directory.
        """
        self.create_v0_if_needed()
        
        latest = self.get_latest_version()
        latest_base = self.get_latest_base_version()
        
        major, minor = self._parse_version(latest)
        
        if is_feedback:
            # minor bump
            new_version = f"v{major}.{minor + 1}"
            base_version = latest_base
        else:
            # major bump from latest base
            base_major, _ = self._parse_version(latest_base)
            new_version = f"v{base_major + 1}"
            base_version = latest_base

        new_dir = self.snapshots_dir / new_version
        if new_dir.exists():
            shutil.rmtree(new_dir)
        new_dir.mkdir(parents=True, exist_ok=True)
        self._copy_skill_files(new_dir)
        
        meta = {
            "reason": reason,
            "source": source,
            "mode": mode,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "base_version": base_version,
            "notes": []
        }
        with open(new_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
            
        return new_version
        
    def accept_latest(self) -> Optional[str]:
        """Accept the latest candidate and make it a new base version."""
        latest = self.get_latest_version()
        if not latest:
            return None
            
        major, minor = self._parse_version(latest)
        if minor == 0:
            return latest # Already a base version
            
        new_version = f"v{major + 1}"
        new_dir = self.snapshots_dir / new_version
        
        # Copy from latest minor version to new major version
        latest_dir = self.snapshots_dir / latest
        if new_dir.exists():
            shutil.rmtree(new_dir)
        shutil.copytree(latest_dir, new_dir, dirs_exist_ok=True)
        
        # Update meta.json
        meta_path = new_dir / "meta.json"
        base_version = None
        latest_meta_path = latest_dir / "meta.json"
        if latest_meta_path.exists():
            try:
                with open(latest_meta_path, "r", encoding="utf-8") as f:
                    latest_meta = json.load(f)
                base_version = latest_meta.get("base_version")
            except Exception:
                base_version = None

        meta = {
            "reason": "用户接受: Accept",
            "source": "user",
            "mode": "accept",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "base_version": base_version,
            "notes": []
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
                
        return new_version

    def revert_to(self, target_version: str) -> bool:
        """Revert the skill directory to the state of the target version."""
        target_dir = self.snapshots_dir / target_version
        if not target_dir.exists():
            return False
            
        # Clear current skill dir contents except snapshots and hidden dirs
        for item in self.skill_dir.iterdir():
            if item.name in ['snapshots', '.git', '.venv', 'venv', '.opt'] or item.name.startswith('.'):
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
                
        # Copy target version contents back
        for item in target_dir.iterdir():
            if item.name == 'meta.json':
                continue
            if item.is_dir():
                shutil.copytree(item, self.skill_dir / item.name, dirs_exist_ok=True)
            else:
                shutil.copy2(item, self.skill_dir / item.name)
                
        return True
