#!/usr/bin/env python3
"""
Queue a branded image post to Buffer.
Usage: python queue_post.py ../branded/queue/<post>.json

JSON fields:
  image          path to the image, relative to the repo root
  caption        full caption (Instagram, Facebook, Threads)
  caption_short  optional caption for X and Bluesky (280/300 char limits)
"""

import json
import os
import sys

import weather

REPO_ROOT = os.path.dirname(weather._SCRIPT_DIR)
SHORT_LIMIT_CHANNELS = ("x/twitter", "bluesky")


def queue_post(spec_path):
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    image_url = weather.upload_image_to_imgbb(os.path.join(REPO_ROOT, spec["image"]))
    if not image_url:
        raise RuntimeError("Image upload failed — not queueing a text-only post")

    caption = spec["caption"]
    short = spec.get("caption_short", caption)
    long_channels = [c for c in weather.BUFFER_CHANNELS if not any(k in c["name"].lower() for k in SHORT_LIMIT_CHANNELS)]
    short_channels = [c for c in weather.BUFFER_CHANNELS if c not in long_channels]

    posted = []
    for channels, text in ((long_channels, caption), (short_channels, short)):
        weather.BUFFER_CHANNELS = channels
        posted += weather.send_to_buffer(text, image_url, immediate=False)
    weather.log.info("Queued %s to %d channel(s)", spec_path, len(posted))


if __name__ == "__main__":
    for path in sys.argv[1:]:
        queue_post(path)
