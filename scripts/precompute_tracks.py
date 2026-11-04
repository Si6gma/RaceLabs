"""
Build frontend/src/data/track_outlines.json from a racelabs-tracks bundle.

The bundle is a directory containing tracks.json, where each entry holds the two
track edges as SVG polyline paths in a shared 200x200 viewBox, pre-oriented to
the circuit's real-world orientation:

    {"id": 0, "name": "Melbourne", "road": "M...", "edges": ["M...", "M..."],
     "startFinish": "M92.5,49.2 L91.8,48.2"}

The two edge paths are index-aligned, so the centerline is the midpoint of each
pair. "road" is edges[0] followed by edges[1] reversed (the closed fill polygon)
and is not needed here; "startFinish" is edges[0][0] -> edges[1][0], which
TrackMapCanvas already draws from the edge arrays.

Usage, from the repo root:

    python3 scripts/precompute_tracks.py ~/Downloads/racelabs-tracks
"""
import argparse
import json
import os
import re

POINT_RE = re.compile(r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")

MIN_POINTS = 2


def parse_path(path: str) -> list:
    """Parse an 'M x,y L x,y ...' polyline into a list of [x, y] points."""
    points = [[float(x), float(y)] for x, y in POINT_RE.findall(path)]
    if len(points) < MIN_POINTS:
        raise ValueError(f"path has {len(points)} point(s), expected at least {MIN_POINTS}")
    return points


def midpoints(a: list, b: list) -> list:
    if len(a) != len(b):
        raise ValueError(f"edge point counts differ: {len(a)} vs {len(b)}")
    return [[round((p[0] + q[0]) / 2, 2), round((p[1] + q[1]) / 2, 2)]
            for p, q in zip(a, b)]


def convert(bundle_dir: str) -> dict:
    with open(os.path.join(bundle_dir, "tracks.json")) as f:
        tracks = json.load(f)

    outlines = {}
    for track in tracks:
        track_id = track["id"]
        edges = track["edges"]
        if len(edges) != 2:
            raise ValueError(f"track {track_id}: expected 2 edges, got {len(edges)}")

        edge_right = parse_path(edges[0])
        edge_left = parse_path(edges[1])
        outlines[str(track_id)] = {
            "name": track["name"],
            "centerline": midpoints(edge_right, edge_left),
            "edge_right": edge_right,
            "edge_left": edge_left,
        }
        print(f"{track_id:2d} {track['name']:<14s} {len(edge_right)} points per edge")

    return outlines


def main() -> None:
    parser = argparse.ArgumentParser(description="Build track_outlines.json from a racelabs-tracks bundle.")
    parser.add_argument("bundle", help="path to the extracted racelabs-tracks directory")
    args = parser.parse_args()

    outlines = convert(args.bundle)

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "frontend", "src", "data", "track_outlines.json")
    out = os.path.normpath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(outlines, f, separators=(",", ":"))

    print(f"\nWrote {len(outlines)} tracks -> {out}")


if __name__ == "__main__":
    main()
