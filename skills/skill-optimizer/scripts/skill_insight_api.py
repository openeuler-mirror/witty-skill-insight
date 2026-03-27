import json
import os
import sys

import requests
from dotenv import load_dotenv

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

_env_loaded = False
_base_url_cache = None
_headers_cache = None


def _ensure_env_loaded():
    """延迟加载环境变量"""
    global _env_loaded
    if not _env_loaded:
        from constants import ENV_FILE

        load_dotenv(ENV_FILE)

        global_env_path = os.path.expanduser("~/.witty/.env")
        if os.path.exists(global_env_path):
            load_dotenv(global_env_path, override=False)

        _env_loaded = True


def _get_base_url():
    """获取 API 基础 URL，延迟加载环境变量"""
    global _base_url_cache

    if _base_url_cache is not None:
        return _base_url_cache

    _ensure_env_loaded()

    base_ip = os.environ.get("SKILL_INSIGHT_HOST")

    if not base_ip:
        raise ValueError(
            f"\n❌ Error: Cannot resolve Skill Insight API IP.\n"
            f"'SKILL_INSIGHT_HOST' environment variable is not set.\n"
            f"This is required for Dynamic/Hybrid modes to fetch historical execution logs."
        )

    if ":" in base_ip and not base_ip.startswith("http"):
        _base_url_cache = f"http://{base_ip}"
    elif base_ip.startswith("http"):
        _base_url_cache = base_ip
    else:
        _base_url_cache = f"http://{base_ip}:3000"

    return _base_url_cache


def _get_headers():
    """获取请求头，延迟加载环境变量"""
    global _headers_cache

    if _headers_cache is not None:
        return _headers_cache

    _ensure_env_loaded()

    _headers_cache = {
        "Content-Type": "application/json",
    }

    return _headers_cache


def get_skill_logs(skill: str, skill_version: int = None, limit: int = 20):
    """
    Get execution logs for a specific skill version.
    """
    base_url = _get_base_url()
    headers = _get_headers()

    _ensure_env_loaded()
    api_key = os.environ.get("SKILL_INSIGHT_API_KEY", "")

    url = f"{base_url}/api/skills/logs"
    params = {
        "skill": skill,
        "apiKey": api_key,
        "limit": limit,
    }
    if skill_version is not None:
        params["skill_version"] = skill_version

    print(f"\n[3] Executing Get Logs Request...")
    print(f"GET {url}")
    print(f"Params: {json.dumps(params, indent=2, ensure_ascii=False)}")

    try:
        response = requests.get(url, params=params, headers=headers)
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
    print(f"Target Base URL: {_get_base_url()}")
    # get_skill_logs("void-gateway-sop")
