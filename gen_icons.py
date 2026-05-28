#!/usr/bin/env python3
"""Generate an 8-bit pixel-art star app icon (warm gold on solid black).

Renders a 32x32 master sprite with 3-tone cel shading + a specular glint,
then upscales with nearest-neighbour to crisp PNGs at the sizes iOS/Android
want. The star fits inside the maskable safe circle (radius 40% of canvas)
so it never gets clipped by adaptive icon masks.
"""
import math
import os

from PIL import Image

N = 32                      # logical sprite grid (chunky 8-bit feel)
C = N / 2.0                 # centre
R = 11.6                    # outer radius  (~72% of width -> maskable safe)
r = R * 0.40                # inner radius
SIZES = (180, 192, 512)     # 180 = apple-touch, 192/512 = manifest

# --- warm gold palette -------------------------------------------------------
BG   = (0, 0, 0)            # solid black
HL   = (255, 231, 150)      # highlight (lit, upper-left)
BASE = (255, 200, 60)       # base gold
SH   = (226, 150, 40)       # shadow (lower-right)
RIM  = (150, 92, 26)        # dark rim on the shadow side
GLINT = (255, 252, 236)     # specular sparkle

# --- build the 10-vertex star polygon ---------------------------------------
verts = []
for k in range(5):
    ao = math.radians(-90 + k * 72)        # outer point
    ai = math.radians(-90 + k * 72 + 36)   # inner point
    verts.append((C + R * math.cos(ao), C + R * math.sin(ao)))
    verts.append((C + r * math.cos(ai), C + r * math.sin(ai)))


def inside(px, py):
    """Ray-cast point-in-polygon."""
    c = False
    n = len(verts)
    j = n - 1
    for i in range(n):
        xi, yi = verts[i]
        xj, yj = verts[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            c = not c
        j = i
    return c


# --- mask + cel shading ------------------------------------------------------
Lx, Ly = -0.60, -0.80       # light from upper-left (y points down)
mask = [[False] * N for _ in range(N)]
col = [[BG] * N for _ in range(N)]

for y in range(N):
    for x in range(N):
        if inside(x + 0.5, y + 0.5):
            mask[y][x] = True

for y in range(N):
    for x in range(N):
        if not mask[y][x]:
            continue
        dx, dy = (x + 0.5 - C), (y + 0.5 - C)
        d = math.hypot(dx, dy) or 1.0
        b = (dx / d) * Lx + (dy / d) * Ly
        # mostly solid gold body, with a shaded lower-right quadrant for form
        col[y][x] = SH if b < -0.35 else BASE


def boundary(x, y):
    for ax, ay in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + ax, y + ay
        if nx < 0 or ny < 0 or nx >= N or ny >= N or not mask[ny][nx]:
            return True
    return False


# dark rim on shadow side, keep the lit edge bright
for y in range(N):
    for x in range(N):
        if mask[y][x] and boundary(x, y):
            dx, dy = (x + 0.5 - C), (y + 0.5 - C)
            d = math.hypot(dx, dy) or 1.0
            b = (dx / d) * Lx + (dy / d) * Ly
            col[y][x] = HL if b > 0.25 else RIM

# specular glint: brightest upper-left highlight pixel -> white
glint = None
for y in range(N):
    for x in range(N):
        if col[y][x] == HL and (glint is None or (x + y) < (glint[0] + glint[1])):
            glint = (x, y)
if glint:
    gx, gy = glint
    col[gy][gx] = GLINT

# --- render ------------------------------------------------------------------
master = Image.new("RGB", (N, N), BG)
for y in range(N):
    for x in range(N):
        master.putpixel((x, y), col[y][x])

out_dir = os.path.dirname(os.path.abspath(__file__))
for size in SIZES:
    master.resize((size, size), Image.NEAREST).save(os.path.join(out_dir, f"icon-{size}.png"))

print("icons written:", ", ".join(f"icon-{s}.png" for s in SIZES))
