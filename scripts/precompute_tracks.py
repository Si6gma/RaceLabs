"""
One-time script to precompute F1 23 circuit outlines from TUMFTM racetrack-database.
Outputs frontend/src/data/track_outlines.json

Run from repo root: python scripts/precompute_tracks.py
"""
import json
import os
import urllib.request
import numpy as np

GITHUB_RAW = "https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/"

# F1 23 track_id → TUMFTM CSV filename (only tracks that exist in the database)
TRACK_MAP = {
    0: "Melbourne",
    2: "Shanghai",
    3: "Sakhir",
    4: "Catalunya",
    6: "Montreal",
    7: "Silverstone",
    8: "Hockenheim",
    9: "Budapest",      # Hungaroring
    10: "Spa",
    11: "Monza",
    13: "Suzuka",
    14: "YasMarina",   # Abu Dhabi
    15: "Austin",      # Texas / COTA
    16: "SaoPaulo",    # Brazil
    17: "Spielberg",   # Austria
    18: "Sochi",
    19: "MexicoCity",
    26: "Zandvoort",
}

# Tracks without TUMFTM data (fall back to live-trace on the frontend):
# 1: Paul Ricard, 5: Monaco, 12: Singapore, 20: Baku,
# 21-24: Short circuits (game-only), 25: Hanoi (never raced),
# 27: Imola, 28: Portimao, 29: Jeddah, 30: Miami, 31: Las Vegas, 32: Losail


def fetch_csv(name: str) -> np.ndarray:
    url = GITHUB_RAW + name + ".csv"
    with urllib.request.urlopen(url, timeout=15) as f:
        raw = f.read().decode("utf-8")
    rows = []
    for line in raw.strip().split("\n")[1:]:  # skip header row
        vals = [float(v) for v in line.split(",")]
        rows.append(vals)
    return np.array(rows)  # columns: x_m, y_m, w_tr_right_m, w_tr_left_m


def compute_edges(data: np.ndarray):
    x = data[:, 0]
    y = data[:, 1]
    w_right = data[:, 2]
    w_left = data[:, 3]
    n = len(x)

    # Tangent via central differences (forward/backward at endpoints)
    tx = np.empty(n)
    ty = np.empty(n)
    tx[1:-1] = x[2:] - x[:-2]
    ty[1:-1] = y[2:] - y[:-2]
    tx[0] = x[1] - x[0]
    ty[0] = y[1] - y[0]
    tx[-1] = x[-1] - x[-2]
    ty[-1] = y[-1] - y[-2]

    length = np.sqrt(tx ** 2 + ty ** 2)
    length = np.where(length == 0, 1.0, length)
    tx /= length
    ty /= length

    # Right normal (rotate tangent 90° clockwise): (ty, -tx)
    # Left normal (rotate tangent 90° counter-clockwise): (-ty, tx)
    right_x = ty
    right_y = -tx
    left_x = -ty
    left_y = tx

    edge_right = np.column_stack([x + right_x * w_right, y + right_y * w_right])
    edge_left = np.column_stack([x + left_x * w_left, y + left_y * w_left])
    centerline = np.column_stack([x, y])

    return centerline, edge_right, edge_left


def to_list(arr: np.ndarray) -> list:
    return [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in arr]


if __name__ == "__main__":
    result = {}
    for track_id, name in TRACK_MAP.items():
        print(f"Fetching {name} (id={track_id})...", end=" ", flush=True)
        try:
            data = fetch_csv(name)
            centerline, edge_right, edge_left = compute_edges(data)
            result[str(track_id)] = {
                "name": name,
                "centerline": to_list(centerline),
                "edge_right": to_list(edge_right),
                "edge_left": to_list(edge_left),
            }
            print(f"{len(centerline)} points")
        except Exception as e:
            print(f"FAILED: {e}")

    out = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "data", "track_outlines.json")
    out = os.path.normpath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    print(f"\nWrote {len(result)} tracks → {out}")
