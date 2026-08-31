#!/usr/bin/env python3
"""
Análisis de una campaña de puntos de control de PinPoint (paper 02_fmv).

Dos subcomandos:

  figuras      Desde campaign.json (o points.csv): estadísticas (RMSE, mediana,
               P90, CE90, máx) y figuras del paper:
                 fig_E1_boxplot.png       actitud vs ortogonal (frames nadir), por FOV
                 fig_E2_centro.png        error vs distancia al centro de la imagen
                 fig_E3_angulo.png        error vs |roll| y vs distancia al nadir
                 fig_E4_along_cross.png   error en ejes de la imagen (along / cross)
               Necesita matplotlib (y numpy). NO necesita el .bin.

  reproyectar  Reproyecta los MISMOS puntos con otros parámetros (terreno,
               FOV, desfase de sincronía) usando pinpoint_core y el .bin del
               vuelo. Sirve para E4a (sensibilidad a Δt), E5 (terreno) y E6
               (FOV) sin volver a marcar nada. Escribe un CSV con una fila por
               punto y variante. Necesita el .bin (y red, si terreno ign/cop).

Ejemplos:
  python scripts/analisis_campana.py figuras --campaign campaign.json --out analisis/
  python scripts/analisis_campana.py reproyectar --campaign campaign.json \\
      --bin 00000064.BIN --terrain flat ign --fov 72.26 80.5 --dt -1 -0.5 -0.2 0 0.2 0.5 1 \\
      --out analisis/reproyectado.csv

Se ejecuta desde la raíz del repo (para importar pinpoint_core).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ----------------------------------------------------------------- utilidades

R_EARTH = 6371000.0


def haversine(lo1, la1, lo2, la2):
    r = math.radians
    dlat, dlng = r(la2 - la1), r(lo2 - lo1)
    a = math.sin(dlat / 2) ** 2 + math.cos(r(la1)) * math.cos(r(la2)) * math.sin(dlng / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def decompose(from_lng, from_lat, to_lng, to_lat):
    """E-O (x) / N-S (y) / directo, metros, de from a to."""
    x = haversine(from_lng, from_lat, to_lng, from_lat) * (1 if to_lng >= from_lng else -1)
    y = haversine(from_lng, from_lat, from_lng, to_lat) * (1 if to_lat >= from_lat else -1)
    return x, y, haversine(from_lng, from_lat, to_lng, to_lat)


def along_cross(x, y, heading_deg):
    h = math.radians(heading_deg)
    return x * math.sin(h) + y * math.cos(h), x * math.cos(h) - y * math.sin(h)


def stats(values):
    v = sorted(float(x) for x in values if x is not None and not math.isnan(float(x)))
    if not v:
        return None
    n = len(v)
    q = lambda p: v[min(n - 1, int(round(p * (n - 1))))]
    return {
        "n": n,
        "rmse": math.sqrt(sum(x * x for x in v) / n),
        "mean": sum(v) / n,
        "median": q(0.5),
        "p90": q(0.9),
        "ce90": q(0.9),   # error circular al 90 %: mismo percentil sobre el módulo
        "max": v[-1],
    }


def load_points(path: str) -> list[dict]:
    """Filas planas (como points.csv) desde campaign.json o desde un CSV."""
    p = Path(path)
    if p.suffix.lower() == ".csv":
        with open(p, newline="", encoding="utf-8") as f:
            return [_num(r) for r in csv.DictReader(f)]
    c = json.loads(p.read_text(encoding="utf-8"))
    rows = []
    for fr in c["frames"]:
        t = fr["telemetry"]
        for pt in fr["points"]:
            eo, ea = pt.get("err_ortho"), pt.get("err_attitude")
            alt = pt.get("alt") or {}
            row = {
                "frame_id": fr["frame_id"], "point_id": pt["id"], "tv_s": t["tv"],
                "img_w": t["imgW"], "img_h": t["imgH"],
                "px": pt["px"], "py": pt["py"],
                "off_x_px": pt["offset_px"]["x"], "off_y_px": pt["offset_px"]["y"], "off_norm_px": pt["offset_px"]["norm"],
                "agl_m": t["agl"], "pitch_deg": t["pitch"], "roll_deg": t["roll"], "yaw_deg": t["yaw"],
                "truth_lat": pt["truth"]["lat"], "truth_lng": pt["truth"]["lng"],
                "truth_dist_m": pt["truth_from_nadir"]["direct"],
                "err_ortho_m": eo["direct"] if eo else None,
                "err_ortho_x_m": eo["x"] if eo else None, "err_ortho_y_m": eo["y"] if eo else None,
                "err_att_m": ea["direct"] if ea else None,
                "err_att_x_m": ea["x"] if ea else None, "err_att_y_m": ea["y"] if ea else None,
                "fov_kind": t.get("fov_kind", "unknown"), "fov_h_deg": t["fov_h"], "aspect": t["aspect"],
                "nadir_ok": 1 if t["nadir_ok"] else 0, "terrain_source": t.get("terrain_source", "flat"),
                "sync_offset_s": t["sync_offset"],
                "alt_fov_kind": alt.get("fov_kind"), "alt_fov_h_deg": alt.get("fov_h"),
                "alt_err_att_m": (alt.get("err_attitude") or {}).get("direct"),
                "alt_err_ortho_m": (alt.get("err_ortho") or {}).get("direct"),
            }
            rows.append(row)
    return rows


def _num(r: dict) -> dict:
    out = {}
    for k, v in r.items():
        if v is None or v == "":
            out[k] = None
            continue
        try:
            out[k] = float(v)
        except ValueError:
            out[k] = v
    return out


# ----------------------------------------------------------------- figuras

def cmd_figuras(a):
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = load_points(a.campaign)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    nadir = [r for r in rows if r.get("nadir_ok") in (1, 1.0, "1")]
    print(f"{len(rows)} puntos, {len(nadir)} en frames nadir")

    # --- tabla de estadísticas ---
    table = {}
    for label, pool in (("todos", rows), ("nadir", nadir)):
        for col in ("err_att_m", "err_ortho_m", "alt_err_att_m", "alt_err_ortho_m"):
            s = stats([r.get(col) for r in pool])
            if s:
                table[f"{label}.{col}"] = s
    (out / "estadisticas.json").write_text(json.dumps(table, indent=1))
    print(f"{'conjunto.columna':34s} {'n':>4s} {'RMSE':>7s} {'med':>7s} {'P90':>7s} {'max':>7s}")
    for k, s in table.items():
        print(f"{k:34s} {s['n']:4d} {s['rmse']:7.2f} {s['median']:7.2f} {s['p90']:7.2f} {s['max']:7.2f}")

    kind = nadir[0]["fov_kind"] if nadir else "?"
    alt_kind = next((r["alt_fov_kind"] for r in nadir if r.get("alt_fov_kind")), None)

    # --- E1: boxplot actitud vs ortogonal (y con el otro FOV si lo hay) ---
    data, labels = [], []
    for col, lab in (("err_att_m", f"actitud ({kind})"), ("err_ortho_m", f"ortogonal ({kind})"),
                     ("alt_err_att_m", f"actitud ({alt_kind})"), ("alt_err_ortho_m", f"ortogonal ({alt_kind})")):
        v = [r[col] for r in nadir if r.get(col) is not None]
        if v:
            data.append(v)
            labels.append(lab)
    if data:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.boxplot(data, tick_labels=labels, showfliers=True)
        ax.set_ylabel("error radial (m)")
        ax.set_title(f"E1 · frames nadir (n={len(nadir)})")
        ax.grid(axis="y", alpha=.3)
        fig.tight_layout()
        fig.savefig(out / "fig_E1_boxplot.png", dpi=160)

    # --- E2: error vs distancia al centro ---
    pts = [(r["off_norm_px"], r["err_att_m"], r["err_ortho_m"]) for r in nadir if r.get("err_att_m") is not None]
    if pts:
        x = np.array([p[0] for p in pts]); ya = np.array([p[1] for p in pts]); yo = np.array([p[2] or np.nan for p in pts])
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.scatter(x, yo, s=14, c="#2563eb", alpha=.6, label="ortogonal")
        ax.scatter(x, ya, s=16, c="#dc2626", alpha=.8, label="actitud")
        if len(x) >= 3:
            k, b = np.polyfit(x, ya, 1)
            xs = np.linspace(0, x.max(), 50)
            ax.plot(xs, k * xs + b, c="#dc2626", lw=1, ls="--", label=f"ajuste: {b:.1f} + {k*100:.2f} m/100px")
        ax.set_xlabel("distancia del píxel al centro de la imagen (px)")
        ax.set_ylabel("error radial (m)")
        ax.set_title("E2 · error vs distancia al centro (frames nadir)")
        ax.grid(alpha=.3); ax.legend(fontsize=8)
        fig.tight_layout(); fig.savefig(out / "fig_E2_centro.png", dpi=160)

    # --- E3: error vs |roll| y vs distancia al nadir (todos los frames) ---
    pts = [(abs(r["roll_deg"]), r["truth_dist_m"], r["err_att_m"], r["err_ortho_m"]) for r in rows if r.get("err_att_m") is not None]
    if pts:
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4))
        rl = np.array([p[0] for p in pts]); d = np.array([p[1] for p in pts])
        ea = np.array([p[2] for p in pts]); eo = np.array([p[3] or np.nan for p in pts])
        a1.scatter(rl, eo, s=14, c="#2563eb", alpha=.6, label="ortogonal")
        a1.scatter(rl, ea, s=16, c="#dc2626", alpha=.8, label="actitud")
        a1.set_xlabel("|roll| del dron (°)"); a1.set_ylabel("error radial (m)"); a1.set_yscale("log")
        a1.grid(alpha=.3, which="both"); a1.legend(fontsize=8); a1.set_title("E3 · error vs alabeo")
        a2.scatter(d, ea, s=16, c="#dc2626", alpha=.8)
        a2.set_xlabel("distancia verdad-terreno → nadir (m)"); a2.set_ylabel("error actitud (m)"); a2.set_yscale("log")
        a2.grid(alpha=.3, which="both"); a2.set_title("E3 · error vs distancia al nadir")
        fig.tight_layout(); fig.savefig(out / "fig_E3_angulo.png", dpi=160)

    # --- E4: along / cross ---
    pts = [along_cross(r["err_att_x_m"], r["err_att_y_m"], r["yaw_deg"]) for r in nadir if r.get("err_att_x_m") is not None]
    if pts:
        al = np.array([p[0] for p in pts]); cr = np.array([p[1] for p in pts])
        fig, ax = plt.subplots(figsize=(5, 5))
        ax.axhline(0, c="#999", lw=.8); ax.axvline(0, c="#999", lw=.8)
        ax.scatter(cr, al, s=18, c="#dc2626", alpha=.8)
        ax.set_xlabel("cross-track (m)  + derecha"); ax.set_ylabel("along-track (m)  + delante")
        ax.set_title(f"E4 · actitud, ejes de la imagen · media along {al.mean():+.1f} m, cross {cr.mean():+.1f} m")
        ax.set_aspect("equal"); ax.grid(alpha=.3)
        fig.tight_layout(); fig.savefig(out / "fig_E4_along_cross.png", dpi=160)

    print(f"figuras en {out}/")


# ----------------------------------------------------------------- reproyección

def cmd_reproyectar(a):
    from pinpoint_core import binlog as _binlog, sync as _sync, footprint as _footprint, terrain as _terrain

    c = json.loads(Path(a.campaign).read_text(encoding="utf-8"))
    cfg = c.get("config", {})
    log = _binlog.parse_bin(a.bin)
    base_offset = cfg.get("sync", {}).get("offset_s", 0.0)
    aspect = cfg.get("fov", {}).get("aspect", 16 / 9)
    fovs = a.fov or [None]        # None = el que llevaba cada punto
    dts = a.dt or [0.0]
    terrains = a.terrain or ["flat"]

    models = {}
    bbox = _terrain.BBox(*log.bbox())
    for tsrc in terrains:
        models[tsrc] = (None, "flat") if tsrc == "flat" else _terrain.load_terrain(tsrc, bbox, ground_msl=log.alt0)

    def fov_v(fh):
        return math.degrees(2 * math.atan(math.tan(math.radians(fh / 2)) / aspect))

    out_rows = []
    for fr in c["frames"]:
        t = fr["telemetry"]
        for pt in fr["points"]:
            for tsrc in terrains:
                model, eff = models[tsrc]
                for dt in dts:
                    sr = _sync.manual(base_offset + dt)
                    t_log = log.t0_us + sr.video_start_trel + t["tv"]
                    lat_d, lng_d, _ = log.interp_position(t_log)
                    ground = None
                    if model is not None and eff != "flat":
                        ground = model.elevation(lat_d, lng_d)
                    for fh in fovs:
                        fov_h = fh if fh is not None else t["fov_h"]
                        for ortho in (False, True):
                            r = _footprint.project_pixel(
                                log, sr, t["tv"], pt["px"], pt["py"], t["imgW"], t["imgH"],
                                fov_h=fov_h, fov_v=fov_v(fov_h),
                                pitch_offset=t.get("d_pitch", 0.0), roll_offset=t.get("d_roll", 0.0),
                                ortho=ortho, ground_alt_msl=ground,
                            )
                            if r.get("valid"):
                                x, y, d = decompose(r["lng"], r["lat"], pt["truth"]["lng"], pt["truth"]["lat"])
                                al, cr = along_cross(x, y, t["yaw"])
                            else:
                                x = y = d = al = cr = None
                            out_rows.append({
                                "frame_id": fr["frame_id"], "point_id": pt["id"], "tv_s": t["tv"],
                                "off_norm_px": pt["offset_px"]["norm"], "roll_deg": t["roll"], "agl_m": t["agl"],
                                "nadir_ok": 1 if t["nadir_ok"] else 0, "truth_dist_m": pt["truth_from_nadir"]["direct"],
                                "terrain": tsrc, "terrain_eff": eff, "dt_s": dt, "fov_h_deg": fov_h,
                                "proj": "ortho" if ortho else "attitude",
                                "err_x_m": x, "err_y_m": y, "err_along_m": al, "err_cross_m": cr, "err_m": d,
                            })
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print(f"{len(out_rows)} filas -> {out}")

    # resumen rápido: RMSE por variante (actitud, frames nadir)
    from collections import defaultdict
    g = defaultdict(list)
    for r in out_rows:
        if r["proj"] == "attitude" and r["nadir_ok"] and r["err_m"] is not None:
            g[(r["terrain"], r["dt_s"], r["fov_h_deg"])].append(r["err_m"])
    print(f"{'terreno':8s} {'dt':>6s} {'fov':>7s} {'n':>4s} {'RMSE':>7s} {'med':>7s} {'P90':>7s}")
    for (tsrc, dt, fh), v in sorted(g.items()):
        s = stats(v)
        print(f"{tsrc:8s} {dt:+6.2f} {fh:7.2f} {s['n']:4d} {s['rmse']:7.2f} {s['median']:7.2f} {s['p90']:7.2f}")


# ----------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("figuras")
    f.add_argument("--campaign", required=True, help="campaign.json o points.csv")
    f.add_argument("--out", default="analisis")
    f.set_defaults(fn=cmd_figuras)
    r = sub.add_parser("reproyectar")
    r.add_argument("--campaign", required=True, help="campaign.json (necesita px/py y config)")
    r.add_argument("--bin", required=True)
    r.add_argument("--terrain", nargs="*", choices=["flat", "ign", "cop"])
    r.add_argument("--fov", nargs="*", type=float, help="FOV horizontales a probar (grados)")
    r.add_argument("--dt", nargs="*", type=float, help="desfases de sincronía a inyectar (s)")
    r.add_argument("--out", default="analisis/reproyectado.csv")
    r.set_defaults(fn=cmd_reproyectar)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
