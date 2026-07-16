"""
Inspección y extracción de frames de vídeo con ffprobe / ffmpeg.

No parsea el contenedor a mano: delega en ffprobe (metadatos) y ffmpeg
(extracción), que ya tratan .mkv, .mp4, .mov, .ts, etc.

Descubrimiento clave que este módulo expone:
  - El .mkv original conserva creation_time; un .mp4 re-codificado por ffmpeg
    (encoder=LavfXX) suele PERDERLO. Siempre preferir el original.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class VideoInfo:
    path: str
    duration_s: float
    fps: float
    width: int
    height: int
    nb_frames: int | None
    creation_time: datetime | None   # UTC tal cual lo declara el contenedor
    encoder: str | None              # p.ej. "Lavf60.16.100" -> re-codificado

    @property
    def is_reencoded(self) -> bool:
        """Heurística: si el encoder es Lavf (ffmpeg) el fichero fue
        re-codificado y su creation_time puede haberse perdido/alterado."""
        return bool(self.encoder and self.encoder.lower().startswith("lavf"))


def _run(cmd: list[str]) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{cmd[0]} falló: {res.stderr.strip()[:500]}")
    return res.stdout


def probe(path: str) -> VideoInfo:
    """Metadatos del vídeo vía ffprobe (JSON)."""
    out = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ])
    data = json.loads(out)
    vstream = next(
        (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    if vstream is None:
        raise ValueError(f"{path} no tiene stream de vídeo.")

    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or vstream.get("duration") or 0.0)

    # r_frame_rate viene como "60/1"
    num, _, den = vstream.get("r_frame_rate", "0/1").partition("/")
    fps = (float(num) / float(den)) if den and float(den) != 0 else 0.0

    # creation_time puede estar en format.tags o en el stream
    ct_raw = (fmt.get("tags", {}) or {}).get("creation_time") or (
        vstream.get("tags", {}) or {}
    ).get("creation_time")
    creation_time = _parse_iso_utc(ct_raw) if ct_raw else None

    encoder = (fmt.get("tags", {}) or {}).get("encoder")
    nb = vstream.get("nb_frames")

    return VideoInfo(
        path=path,
        duration_s=duration,
        fps=fps,
        width=int(vstream.get("width", 0)),
        height=int(vstream.get("height", 0)),
        nb_frames=int(nb) if nb and str(nb).isdigit() else None,
        creation_time=creation_time,
        encoder=encoder,
    )


def _parse_iso_utc(s: str) -> datetime:
    """Parsea el creation_time ISO del contenedor a datetime aware (UTC)."""
    s = s.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def extract_single_frame(video_path: str, tv: float, *, quality: int = 3) -> bytes:
    """Extrae UN frame en el instante tv (s) y lo devuelve como bytes JPEG.

    Para el previsualizador de solape del front. `-ss` antes de `-i` hace seek
    rápido (keyframe-based, suficientemente preciso para juzgar solape)."""
    import subprocess

    cmd = [
        "ffmpeg", "-v", "error",
        "-ss", f"{max(0.0, tv):.3f}",
        "-i", video_path,
        "-frames:v", "1",
        "-qscale:v", str(quality),
        "-f", "image2pipe", "-vcodec", "mjpeg",
        "pipe:1",
    ]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0 or not res.stdout:
        raise RuntimeError(
            f"ffmpeg no pudo extraer el frame en tv={tv}: "
            f"{res.stderr.decode(errors='ignore')[:300]}"
        )
    return res.stdout
