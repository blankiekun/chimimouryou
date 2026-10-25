# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""Checks and clamps the activity a page sends before it goes to Discord.

Only the fields below pass; anything else is dropped. Limits are Discord's SET_ACTIVITY ones.
"""

import re

TEXT_MAX = 128
URL_MAX = 256
BUTTON_LABEL_MAX = 32
BUTTON_URL_MAX = 512
MAX_TIMESTAMP = 1 << 53
ASSET_KEY = re.compile(r"^[A-Za-z0-9_-]{1,256}$")


class InvalidActivity(ValueError):
    pass


def _text(value, max_len=TEXT_MAX, min_len=2):
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    if len(value) > max_len:
        value = value[: max_len - 1] + "…"
    return value if len(value) >= min_len else None


def _url(value, max_len=URL_MAX):
    if not isinstance(value, str) or len(value) > max_len:
        return None
    value = value.strip()
    if not value.lower().startswith("https://") or len(value) <= len("https://") or any(c.isspace() for c in value):
        return None
    return value


def _image(value):
    if isinstance(value, str) and ASSET_KEY.match(value):
        return value
    return _url(value)


def _int(value, low=0, high=MAX_TIMESTAMP):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = int(value)
    return value if low <= value <= high else None


def clean(raw):
    """Returns the activity Discord gets, or raises InvalidActivity."""
    if not isinstance(raw, dict):
        raise InvalidActivity("activity must be an object")
    out = {"type": 0}
    for key in ("name", "details", "state"):
        value = _text(raw.get(key))
        if value:
            out[key] = value
    for key in ("details_url", "state_url"):
        value = _url(raw.get(key))
        if value:
            out[key] = value

    assets = raw.get("assets")
    if isinstance(assets, dict):
        clean_assets = {}
        for size in ("large", "small"):
            image = _image(assets.get(size + "_image"))
            if image:
                clean_assets[size + "_image"] = image
                text = _text(assets.get(size + "_text"))
                if text:
                    clean_assets[size + "_text"] = text
        if clean_assets:
            out["assets"] = clean_assets

    timestamps = raw.get("timestamps")
    if isinstance(timestamps, dict):
        clean_ts = {}
        for key in ("start", "end"):
            value = _int(timestamps.get(key), low=1)
            if value:
                clean_ts[key] = value
        if "start" in clean_ts and "end" in clean_ts and clean_ts["end"] < clean_ts["start"]:
            del clean_ts["end"]
        if clean_ts:
            out["timestamps"] = clean_ts

    party = raw.get("party")
    size = party.get("size") if isinstance(party, dict) else None
    if isinstance(size, list) and len(size) == 2:
        current, maximum = _int(size[0], 1, 1 << 31), _int(size[1], 1, 1 << 31)
        if current and maximum and current <= maximum:
            out["party"] = {"size": [current, maximum]}

    buttons = raw.get("buttons")
    if isinstance(buttons, list):
        clean_buttons = []
        for button in buttons[:2]:
            if not isinstance(button, dict):
                continue
            label = _text(button.get("label"), BUTTON_LABEL_MAX, 1)
            url = _url(button.get("url"), BUTTON_URL_MAX)
            if label and url:
                clean_buttons.append({"label": label, "url": url})
        if clean_buttons:
            out["buttons"] = clean_buttons

    if not any(k in out for k in ("name", "details", "state")):
        raise InvalidActivity("activity needs a name, details or state")
    return out
