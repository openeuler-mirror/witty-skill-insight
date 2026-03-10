import json
import os
import sys

import requests
from dotenv import load_dotenv

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from constants import ENV_FILE

load_dotenv(ENV_FILE)

# Attempt to read global Witty Insight config
global_env_path = os.path.expanduser("~/.witty/.env")
if os.path.exists(global_env_path):
    load_dotenv(
        global_env_path, override=False
    )  # Do not override local optimizer .env if it has values

# Resolve base IP: local MODEL_PROXY_IP > global WITTY_INSIGHT_HOST
base_ip = os.environ.get("MODEL_PROXY_IP") or os.environ.get("WITTY_INSIGHT_HOST")

if not base_ip:
    raise ValueError(
        f"\\n❌ Error: Cannot resolve Witty Insight API IP.\\n"
        f"Neither 'MODEL_PROXY_IP' (in {ENV_FILE.absolute()}) nor 'WITTY_INSIGHT_HOST' (in ~/.witty/.env) is set.\\n"
        f"This is required for Dynamic/Hybrid modes to fetch historical execution logs."
    )

# Assume the platform always runs on port 3000 locally or adjust if WITTY_INSIGHT_HOST includes port
if ":" in base_ip and not base_ip.startswith("http"):
    BASE_URL = f"http://{base_ip}"
elif base_ip.startswith("http"):
    BASE_URL = base_ip
else:
    BASE_URL = f"http://{base_ip}:3000"


HEADERS = {
    "Content-Type": "application/json",
    "x-witty-api-key": os.environ.get("DEEPSEEK_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
    or "",
}


def get_skill_logs(skill: str, skill_version: int = None, limit: int = 20):
    """
    Get execution logs for a specific skill version.
    """
    url = f"{BASE_URL}/api/skills/logs"
    params = {
        "skill": skill,
        "limit": limit,
    }
    if skill_version is not None:
        params["skill_version"] = skill_version

    print(f"\n[3] Executing Get Logs Request...")
    print(f"GET {url}")
    print(f"Params: {json.dumps(params, indent=2, ensure_ascii=False)}")

    try:
        response = requests.get(url, params=params, headers=HEADERS)
        print(f"Status Code: {response.status_code}")
        try:
            result = response.json()
            if isinstance(result, list):
                print(f"Response Body Length: {len(result)}")
                return result
            else:
                print(f"Unexpected response format (expected list): {result}")
                return []
        except json.JSONDecodeError:
            print(f"Response Body (Text): {response.text}")
    except Exception as e:
        print(f"Error executing get logs request: {e}")


if __name__ == "__main__":
    print(f"Target Base URL: {BASE_URL}")
    # get_skill_logs("void-gateway-sop")
