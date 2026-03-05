#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def test_connectivity(api_key, base_url, model):
    if not api_key:
        print("API Key is missing.")
        return False

    print(f"Testing connectivity to {base_url} with model {model}...")

    if not base_url.endswith("/"):
        base_url += "/"

    url = base_url
    is_anthropic = "anthropic" in base_url.lower()

    if is_anthropic:
        if "messages" not in url:
            url = (
                base_url + "v1/messages"
                if not base_url.endswith("v1/")
                else base_url + "messages"
            )
    else:
        if "chat/completions" not in url:
            if url.endswith("v1/"):
                url += "chat/completions"
            else:
                url += "v1/chat/completions"

    headers = {"Content-Type": "application/json"}

    if is_anthropic:
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
        data = {
            "model": model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Hello"}],
        }
    else:
        headers["Authorization"] = f"Bearer {api_key}"
        data = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": "Hello, this is a connectivity test. Please reply 'OK'.",
                }
            ],
            "max_tokens": 10,
        }

    try:
        req = urllib.request.Request(
            url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
            print("✅ Connectivity test passed!")
            return True
    except urllib.error.HTTPError as e:
        try:
            error_msg = e.read().decode("utf-8")
        except:
            error_msg = str(e)
        print(f"❌ HTTP Error: {e.code} - {error_msg}")
        return False
    except urllib.error.URLError as e:
        print(f"❌ URL Error: {e.reason}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test LLM Connectivity")
    parser.add_argument("--api-key", help="API Key")
    parser.add_argument("--base-url", help="Base URL")
    parser.add_argument("--model", help="Model name")
    parser.add_argument("--env-file", help="Path to .env file to load fallback config")

    args = parser.parse_args()

    api_key = args.api_key
    base_url = args.base_url
    model = args.model

    if args.env_file and os.path.exists(args.env_file):
        with open(args.env_file, "r") as f:
            for line in f:
                if line.strip() and not line.startswith("#") and "=" in line:
                    key, val = line.strip().split("=", 1)
                    val = val.strip(" '\"")
                    if not api_key and (
                        key.endswith("_API_KEY") or key == "LLM_API_KEY"
                    ):
                        api_key = val
                    if not base_url and (
                        key.endswith("_BASE_URL") or key == "LLM_BASE_URL"
                    ):
                        base_url = val
                    if not model and (key.endswith("_MODEL") or key == "LLM_MODEL"):
                        model = val

    # Additional fallbacks from environment
    if not api_key:
        api_key = (
            os.environ.get("LLM_API_KEY")
            or os.environ.get("DEEPSEEK_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        )
    if not base_url:
        base_url = (
            os.environ.get("LLM_BASE_URL")
            or os.environ.get("DEEPSEEK_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or os.environ.get("ANTHROPIC_BASE_URL")
            or "https://api.deepseek.com/"
        )
    if not model:
        model = (
            os.environ.get("LLM_MODEL")
            or os.environ.get("DEEPSEEK_MODEL")
            or os.environ.get("OPENAI_MODEL")
            or os.environ.get("ANTHROPIC_MODEL")
            or "deepseek-chat"
        )

    success = test_connectivity(api_key, base_url, model)
    sys.exit(0 if success else 1)
