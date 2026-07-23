"""
Configuration management for torbox-streamer.
Loads settings from environment variables or a .env file.
"""

import os
import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "torbox-streamer"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULTS = {
    "torbox_api_key": "",
    "torrentio_base_url": "https://torrentio.strem.fun",
    "mpv_path": "mpv",
    "max_results": 20,
    "auto_pick_best_cached": False,
    "preferred_quality": "1080p",
}


def load_config() -> dict:
    """Load config from file, falling back to env vars and defaults."""
    config = dict(DEFAULTS)

    # Load from config file if it exists
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE) as f:
                file_config = json.load(f)
            config.update(file_config)
        except (json.JSONDecodeError, IOError):
            pass

    # Environment variables override file config
    env_mappings = {
        "torbox_api_key": "TORBOX_API_KEY",
        "torrentio_base_url": "TORRENTIO_BASE_URL",
        "mpv_path": "MPV_PATH",
        "max_results": "MAX_RESULTS",
        "auto_pick_best_cached": "AUTO_PICK_BEST_CACHED",
        "preferred_quality": "PREFERRED_QUALITY",
    }

    for key, env_var in env_mappings.items():
        val = os.environ.get(env_var)
        if val is not None:
            # Type coercion
            if key in ("max_results",):
                config[key] = int(val)
            elif key in ("auto_pick_best_cached",):
                config[key] = val.lower() in ("1", "true", "yes")
            else:
                config[key] = val

    return config


def save_config(config: dict):
    """Save config to file."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def get_api_key(config: dict) -> str:
    """Get the TorBox API key, prompting if not set."""
    if config.get("torbox_api_key"):
        return config["torbox_api_key"]
    
    key = input("Enter your TorBox API key: ").strip()
    if key:
        config["torbox_api_key"] = key
        save_config(config)
    return key
