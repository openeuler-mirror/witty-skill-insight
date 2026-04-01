from pathlib import Path

# Workspace Root
WORKSPACE_DIR = Path(__file__).parent.parent
ENV_FILE = WORKSPACE_DIR / ".env"

GLOBAL_CONFIG_DIR = Path.home() / ".skill-insight"
GLOBAL_ENV_FILE = GLOBAL_CONFIG_DIR / ".env"
