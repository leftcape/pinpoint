"""
Candidatos de fotograma para la campaña de puntos de control, desde el log.

El operador tiene que mirar cada frame y decidir; esto sólo le ahorra buscar.
Dos modos:

  straight  (E1, error nominal): instantes en pasadas rectas y cenitales
            (|roll| pequeño, gimbal a -90°, yaw estable, altura suficiente),
            repartidos uniformemente a lo largo del vídeo: se divide la
            duración en n tramos y en cada uno se elige el instante de menor
            |roll|.
  turns     (E3, error vs ángulo): instantes con alabeo creciente (los virajes
            del lawnmower), uno o dos por franja de |roll| (3-6°, 6-10°, …,
            50-60°), separados en el tiempo para no repetir el mismo viraje.

Sólo telemetría: no mira el vídeo (blur, exposición) — eso lo juzga el ojo.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict

from .binlog import BinLog
from .sync import SyncResult

ROLL_BINS = [3.0, 6.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, 50.0, 60.0]


@dataclass
class Candidate:
    tv: float            # instante del vídeo (s)
    roll: float          # alabeo del dron (°)
    pitch: float         # cabeceo del gimbal, marco terrestre (°; -90 = nadir)
    yaw: float           # rumbo (°)
    yaw_rate: float      # velocidad de giro (°/s): 0 en recta
    agl: float           # altura sobre la cota de despegue (m)
    kind: str            # "straight" | "turns"
    bin: str             # tramo temporal (straight) o franja de roll (turns)


def _wrap(d: float) -> float:
    while d > 180:
        d -= 360
    while d < -180:
        d += 360
    return d


def _samples(log: BinLog, sr: SyncResult, duration_s: float, step: float):
    """Muestrea la telemetría a lo largo del vídeo. Devuelve dicts crudos."""
    out = []
    prev_yaw = None
    tv = 0.0
    while tv <= duration_s:
        t_rel = sr.video_start_trel + tv
        if 0.0 <= t_rel <= log.duration_s:
            t_log = log.t0_us + t_rel
            _lat, _lng, alt = log.interp_position(t_log)
            roll, _dpitch, yaw = log.drone_attitude_at(t_log)
            _, pitch, yaw_mnt = log.camera_orientation_at(t_log)
            if not log.att_t:
                yaw = yaw_mnt
            rate = 0.0 if prev_yaw is None else abs(_wrap(yaw - prev_yaw)) / step
            prev_yaw = yaw
            out.append({
                "tv": tv, "roll": roll, "pitch": pitch, "yaw": yaw,
                "yaw_rate": rate, "agl": alt - log.alt0,
            })
        tv += step
    return out


def straight_candidates(
    log: BinLog, sr: SyncResult, duration_s: float,
    n: int = 25, max_roll: float = 3.0, max_pitch_dev: float = 5.0,
    min_agl: float = 20.0, max_yaw_rate: float = 3.0, step: float = 0.5,
) -> list[Candidate]:
    s = _samples(log, sr, duration_s, step)
    ok = [x for x in s
          if abs(x["roll"]) <= max_roll
          and abs(x["pitch"] + 90.0) <= max_pitch_dev
          and x["agl"] >= min_agl
          and x["yaw_rate"] <= max_yaw_rate]
    if not ok or n <= 0:
        return []
    width = duration_s / n
    out: list[Candidate] = []
    for i in range(n):
        lo, hi = i * width, (i + 1) * width
        mid = (lo + hi) / 2
        pool = [x for x in ok if lo <= x["tv"] < hi]
        if not pool:
            continue
        best = min(pool, key=lambda x: (abs(x["roll"]), abs(x["tv"] - mid)))
        out.append(Candidate(kind="straight", bin=f"{lo:.0f}-{hi:.0f}s", **best))
    return out


def turn_candidates(
    log: BinLog, sr: SyncResult, duration_s: float,
    per_bin: int = 2, max_pitch_dev: float = 10.0, min_agl: float = 20.0,
    min_gap_s: float = 20.0, step: float = 0.5,
) -> list[Candidate]:
    s = _samples(log, sr, duration_s, step)
    ok = [x for x in s
          if abs(x["pitch"] + 90.0) <= max_pitch_dev and x["agl"] >= min_agl]
    out: list[Candidate] = []
    for lo, hi in zip(ROLL_BINS[:-1], ROLL_BINS[1:]):
        mid = (lo + hi) / 2
        pool = sorted(
            (x for x in ok if lo <= abs(x["roll"]) < hi),
            key=lambda x: abs(abs(x["roll"]) - mid),
        )
        chosen: list[dict] = []
        for x in pool:
            if all(abs(x["tv"] - c["tv"]) >= min_gap_s for c in chosen):
                chosen.append(x)
            if len(chosen) >= per_bin:
                break
        for x in chosen:
            out.append(Candidate(kind="turns", bin=f"{lo:.0f}-{hi:.0f}°", **x))
    out.sort(key=lambda c: c.tv)
    return out


def to_dicts(cands: list[Candidate]) -> list[dict]:
    return [asdict(c) for c in cands]


__all__ = ["Candidate", "straight_candidates", "turn_candidates", "to_dicts", "ROLL_BINS", "math"]
