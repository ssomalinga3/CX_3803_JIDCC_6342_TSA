"""Convert the checked-in Google My Maps KML using only Python's standard library.

Run from any directory. Does not fetch data or execute source description HTML.
"""
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/cascade-springs"
NS = {"k": "http://www.opengis.net/kml/2.2"}
SOURCE = "https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k"


def convert(raw):
    root = ET.fromstring(raw)
    features = []
    ids = set()
    for placemark in root.findall(".//k:Placemark", NS):
        name = placemark.findtext("k:name", namespaces=NS)
        shapes = [child for child in placemark if child.tag.rsplit("}", 1)[-1]
                  in {"Point", "LineString", "Polygon", "MultiGeometry"}]
        if not name or len(shapes) != 1:
            raise ValueError("Expected a named placemark with one geometry")
        shape = shapes[0]
        kind = shape.tag.rsplit("}", 1)[-1]
        if kind not in {"Point", "LineString"}:
            raise ValueError("Unsupported geometry; review source changes before importing")
        text = shape.findtext("k:coordinates", namespaces=NS) or ""
        coords = [[float(n) for n in token.split(",")] for token in text.split()]
        for coord in coords:
            if (len(coord) not in {2, 3} or not all(math.isfinite(n) for n in coord)
                    or abs(coord[0]) > 180 or abs(coord[1]) > 90):
                raise ValueError("Invalid WGS84 position")
        if any(len(coord) == 3 and coord[2] != 0 for coord in coords):
            raise ValueError("Nonzero elevation requires review for the 2D database")
        # The source has only zero altitude placeholders; storage is explicitly 2D.
        coords = [coord[:2] for coord in coords]
        if (kind == "Point" and len(coords) != 1) or (kind == "LineString" and len(coords) < 2):
            raise ValueError("Invalid coordinate count")
        # Identity follows the source name/type, so geometry corrections retain IDs.
        feature_id = "cascade-map-" + hashlib.sha256((kind + ":" + name).encode()).hexdigest()[:16]
        if feature_id in ids:
            raise ValueError("Duplicate source identity; reconcile before importing")
        ids.add(feature_id)
        features.append({
            "type": "Feature", "id": feature_id,
            "geometry": {"type": kind, "coordinates": coords[0] if kind == "Point" else coords},
            "properties": {
                "name": name,
                "description_html": placemark.findtext("k:description", default="", namespaces=NS),
                "source_url": SOURCE,
                "source_style_url": placemark.findtext("k:styleUrl", default="", namespaces=NS),
                "isDemo": False,
            },
        })
    if not features:
        raise ValueError("Empty source map")
    return {"type": "FeatureCollection", "features": features}


if __name__ == "__main__":
    raw = (DATA / "source.kml").read_bytes()
    output = json.dumps(convert(raw), indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    (DATA / "features.geojson").write_text(output)
    print("Converted source map; SHA-256:", hashlib.sha256(raw).hexdigest())
