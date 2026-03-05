import os
import sys
import requests
import json
from dotenv import load_dotenv

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__))))

from constants import ENV_FILE


load_dotenv(ENV_FILE)
BASE_URL = f'http://{os.environ.get("MODEL_PROXY_IP")}:3000'
HEADERS = {"Content-Type": "application/json"}


def upload_local_skill(path: str):
    """
    Upload local skill folder to create a new version.
    Returns the version number from the response.
    """
    import_url = f"{BASE_URL}/api/skills/automation/import"
    import_payload = {
        "path": path,
        "user": os.environ.get("WITTY_INSIGHT_USER"),
    }

    print(f"\n[1] Executing Upload (Import) Request...")
    print(f"POST {import_url}")
    print(f"Payload: {json.dumps(import_payload, indent=2, ensure_ascii=False)}")

    try:
        response = requests.post(import_url, json=import_payload, headers=HEADERS)
        print(f"Status Code: {response.status_code}")
        try:
            json_response = response.json()
            print(
                f"Response Body: {json.dumps(json_response, indent=2, ensure_ascii=False)}"
            )
            # Extract version from response
            # responsestructure: {"version": 123} based on typical API patterns
            if isinstance(json_response, dict):
                version = json_response.get("version")
                return version
        except json.JSONDecodeError:
            print(f"Response Body (Text): {response.text}")
    except Exception as e:
        print(f"Error executing upload request: {e}")

    return None


def activate_skill_version(skill_name: str, version: int = 0):
    """
    Activate a specific version of the skill.
    """
    push_url = f"{BASE_URL}/api/skills/automation/push"
    push_payload = {
        "name": skill_name,
        "version": version,
        "user": os.environ.get("WITTY_INSIGHT_USER"),
    }

    print(f"\n[2] Executing Activate (Push) Request...")
    print(f"POST {push_url}")
    print(f"Payload: {json.dumps(push_payload, indent=2, ensure_ascii=False)}")

    try:
        response = requests.post(push_url, json=push_payload, headers=HEADERS)
        print(f"Status Code: {response.status_code}")
        try:
            print(
                f"Response Body: {json.dumps(response.json(), indent=2, ensure_ascii=False)}"
            )
        except json.JSONDecodeError:
            print(f"Response Body (Text): {response.text}")
    except Exception as e:
        print(f"Error executing activate request: {e}")


def get_skill_logs(skill: str, skill_version: int = None, limit: int = 20):
    """
    Get execution logs for a specific skill version.
    """
    url = f"{BASE_URL}/api/skills/logs"
    params = {
        "skill": skill,
        "limit": limit,
        "user": os.environ.get("WITTY_INSIGHT_USER"),
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
    # upload_local_skill()
    # activate_skill_version("openEuler-docker-hang_optimized")
    # get_skill_logs("void-gateway-sop")
