"""Acquire a bounded USGS 3DEP subset once; normal conversion runs offline.

Outputs go to .work/gis-data/usgs-acquisition. Review and copy into the source
package explicitly; this command never overwrites committed evidence.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import subprocess
from urllib.parse import urlencode, urlparse

from source_package import PACKAGE, ROOT

SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
BOUNDS = "-84.4845,33.7140,-84.4740,33.7205"
WORK = ROOT / ".work/gis-data/usgs-acquisition"


def request(operation="", **params):
    url = SERVICE + operation + "?" + urlencode({"f": "json", **params})
    result = json.loads(download(url))
    if "error" in result:
        raise ValueError(f"USGS {operation or 'metadata'} failed: {result['error']}")
    return url, result


def download(url):
    # curl also honors the host's managed network/proxy configuration.
    return subprocess.run(
        ["curl", "-fsSL", "--retry", "2", "--max-time", "45", url],
        check=True, capture_output=True,
    ).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--terrain-3d', action='store_true', help='Acquire a separate subset with 3× the original width and height')
    args = parser.parse_args()
    work = WORK if not args.terrain_3d else ROOT / '.work/gis-data/usgs-acquisition-3d'
    work.mkdir(parents=True, exist_ok=True)
    bbox, bbox_sr, size = BOUNDS, 4326, '512,384'
    base_record = None
    if args.terrain_3d:
        base_record = json.loads((PACKAGE / 'sources/usgs-3dep.json').read_text())
        extent = base_record['export']['extent']
        width, height = extent['xmax'] - extent['xmin'], extent['ymax'] - extent['ymin']
        bbox = ','.join(str(v) for v in [extent['xmin'] - width, extent['ymin'] - height,
                                       extent['xmax'] + width, extent['ymax'] + height])
        bbox_sr, size = 3857, '1536,1152'
    _, service = request()
    query, catalog = request(
        "/query", geometry=json.dumps(dict(zip(("xmin", "ymin", "xmax", "ymax"), map(float, bbox.split(","))))), geometryType="esriGeometryEnvelope", inSR=bbox_sr,
        spatialRel="esriSpatialRelIntersects",
        outFields="Name,ProductName,VerticalDatum,Resolution_X,AcquisitionDate,Source,DEM_Type",
        returnGeometry="false",
    )
    params = dict(
        bbox=bbox, bboxSR=bbox_sr, imageSR=3857, size=size, format="tiff",
        pixelType="F32", interpolation="RSP_BilinearInterpolation",
        renderingRule=json.dumps({"rasterFunction": "None"}),
        noData=-999999, noDataInterpretation="esriNoDataMatchAny",
    )
    export_url, export = request("/exportImage", **params)
    href = export.get("href", "")
    if urlparse(href).scheme != "https" or urlparse(href).hostname != "elevation.nationalmap.gov":
        raise ValueError("Unexpected USGS export URL")
    data = download(href)
    if len(data) > (8 if args.terrain_3d else 4) * 1024 * 1024 or data[:4] not in (b"II*\x00", b"MM\x00*"):
        raise ValueError("Expected a bounded GeoTIFF, not a rendered picture/error")
    stem = 'usgs-3dep-3d' if args.terrain_3d else 'usgs-3dep'
    (work / f'{stem}.tif').write_bytes(data)
    record = {
        "schema_version": 1,
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": SERVICE,
        "request_url": export_url,
        "query_url": query,
        "export": {k: v for k, v in export.items() if k != "href"},
        "raster": {"file": f'{stem}.tif', "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
        "service": service,
        "intersecting_catalog": catalog,
        "limitations": "Multi-resolution service export resampled to a bounded display grid; acquisition date is not retrieval date. Catalog intersections are candidates, not proof of per-pixel source. No local survey or navigation accuracy claimed.",
    }
    if base_record:
        record['display_extent_scale'] = 3
        record['base_raster_sha256'] = base_record['raster']['sha256']
        record['base_extent'] = base_record['export']['extent']
    (work / f'{stem}.json').write_text(json.dumps(record, indent=2) + "\n")
    print(f"Acquired {len(data)} bytes in {work.relative_to(ROOT)}; review before committing")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"USGS acquisition failed: {error}")
