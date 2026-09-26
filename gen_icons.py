#!/usr/bin/env python3
"""Build every Star Jar icon PNG from the two master drawings.

Run from this folder:  python3 gen_icons.py

Reads  icon.svg           the 1024 App Store master (glass jar, three gold stars)
       icon-maskable.svg  the same art with the jar shrunk into Android's safe
                          circle, for launchers that crop icons round
Writes favicon-32.png          browser tab
       icon-180.png            iPhone and iPad home screen (apple-touch-icon)
       icon-192.png, icon-512.png                   installed app icon
       icon-maskable-192.png, icon-maskable-512.png Android adaptive icon

The masters come from docs/logo-options/final-3star/make.py (local only, docs/
is gitignored): edit that, rerun it, copy icon.svg and icon-maskable.svg here,
then run this. Each size is drawn fresh from the vector art by headless Chrome,
so small sizes stay sharp. The PNGs are opaque, which home screens and the App
Store expect. Bump CACHE in sw.js whenever these files change.
"""
import os
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUTPUTS = [
    ("icon.svg", 32, "favicon-32.png"),
    ("icon.svg", 180, "icon-180.png"),
    ("icon.svg", 192, "icon-192.png"),
    ("icon.svg", 512, "icon-512.png"),
    ("icon-maskable.svg", 192, "icon-maskable-192.png"),
    ("icon-maskable.svg", 512, "icon-maskable-512.png"),
]
PAGE = ('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}'
        'img{display:block;width:%dpx;height:%dpx}</style></head>'
        '<body><img src="file://%s"></body></html>')


def shoot(svg, size, png):
    """Screenshot the SVG at exactly size x size. Chrome with its own profile
    writes the file but does not always quit, so wait for it, then close it."""
    if os.path.exists(png):
        os.remove(png)
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "icon.html")
        with open(page, "w") as fh:
            fh.write(PAGE % (size, size, svg))
        proc = subprocess.Popen(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
             "--no-default-browser-check", f"--user-data-dir={tmp}/profile",
             "--force-device-scale-factor=1", f"--window-size={size},{size}",
             "--virtual-time-budget=3000", f"--screenshot={png}", "file://" + page],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline, last = time.time() + 60, -1
        while time.time() < deadline:
            if os.path.exists(png):
                n = os.path.getsize(png)
                if proc.poll() is not None or (n > 0 and n == last):
                    break
                last = n
            time.sleep(0.5)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
    if not os.path.exists(png):
        sys.exit(f"render failed: {png}")


def main():
    for svg, size, name in OUTPUTS:
        shoot(os.path.join(HERE, svg), size, os.path.join(HERE, name))
    print("icons written:", ", ".join(name for _, _, name in OUTPUTS))


if __name__ == "__main__":
    main()
