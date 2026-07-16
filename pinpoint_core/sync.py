"""
Sincronización temporal entre el vídeo y el log.

El problema: el vídeo (tiempo relativo, tv=0 en su primer frame) y el log
(tiempo del autopiloto) son dos relojes distintos. Necesitamos un OFFSET: a qué
instante del log corresponde el frame 0 del vídeo.

    t_log(frame en tv) = log.t0_us + video_start_trel + tv

donde `video_start_trel` es el tiempo RELATIVO del log (s desde el primer fix)
en el que arranca el vídeo. Es el único número que hay que clavar.

Tres métodos para obtenerlo, de más a menos automático:

  1. TAKEOFF  — detectar el despegue en el log. Robusto si el vídeo empezó a
     grabar en el despegue (caso muy común). Devolvió 21.2 s en la referencia.
  2. CREATION_TIME — casar el creation_time del vídeo con el reloj UTC del log,
     corrigiendo la zona horaria (la cámara suele grabar en local etiquetado
     como UTC). En la referencia el desfase era exactamente -2 h (CEST).
  3. MANUAL — el usuario fija el offset a mano (el ajustador del front escribe
     aquí). Es el que se usa para el ajuste fino visual.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from .binlog import BinLog
from .video import VideoInfo


@dataclass
class SyncResult:
    video_start_trel: float      # s relativos del log donde arranca el vídeo (frame 0)
    method: str                  # "takeoff" | "creation_time" | "manual"
    detail: str                  # explicación legible para el front/CLI
    tz_offset_hours: float = 0.0 # corrección de zona horaria aplicada (informativo)


def by_takeoff(
    log: BinLog, min_alt_rel: float = 3.0, min_spd: float = 1.0
) -> SyncResult:
    """Ancla el frame 0 del vídeo al despegue detectado en el log."""
    trel = log.detect_takeoff(min_alt_rel=min_alt_rel, min_spd=min_spd)
    if trel is None:
        raise ValueError(
            "No se pudo detectar el despegue (¿el dron no llegó a volar?). "
            "Usa el método creation_time o un offset manual."
        )
    return SyncResult(
        video_start_trel=trel,
        method="takeoff",
        detail=(
            f"Despegue detectado a t_rel={trel:.1f}s "
            f"(alt>{min_alt_rel}m y vel>{min_spd}m/s). Se asume que el vídeo "
            "empezó a grabar en el despegue."
        ),
    )


def by_creation_time(log: BinLog, video: VideoInfo) -> SyncResult:
    """Ancla usando el creation_time del vídeo contra el reloj UTC del log.

    Corrige automáticamente la zona horaria redondeando el desfase a la hora
    entera más cercana (los desfases de TZ son múltiplos de horas —a veces
    medias horas—; el residuo es el offset real de arranque de grabación)."""
    if video.creation_time is None:
        raise ValueError(
            "El vídeo no tiene creation_time (¿re-codificado?). "
            "Usa el .mkv original, el método takeoff, o un offset manual."
        )

    # desfase bruto entre lo que declara el vídeo y el inicio del log, en segundos
    raw = (video.creation_time - log.utc_start).total_seconds()

    # la parte de zona horaria es el múltiplo de hora más cercano
    tz_hours = round(raw / 3600.0)
    residual = raw - tz_hours * 3600.0  # offset real de arranque (s)

    if video.is_reencoded:
        warn = " AVISO: el vídeo parece re-codificado; su creation_time puede no ser fiable."
    else:
        warn = ""

    return SyncResult(
        video_start_trel=residual,
        method="creation_time",
        detail=(
            f"creation_time del vídeo = {video.creation_time.isoformat()}; "
            f"inicio del log (UTC) = {log.utc_start.isoformat()}. "
            f"Desfase bruto {raw:.1f}s -> corrección TZ {tz_hours:+d}h -> "
            f"arranque del vídeo a t_rel={residual:.1f}s del log.{warn}"
        ),
        tz_offset_hours=float(tz_hours),
    )


def manual(video_start_trel: float) -> SyncResult:
    """Offset fijado a mano (el ajustador visual del front escribe aquí)."""
    return SyncResult(
        video_start_trel=video_start_trel,
        method="manual",
        detail=f"Offset manual: el vídeo arranca a t_rel={video_start_trel:.2f}s del log.",
    )


def position_for_video_time(
    log: BinLog, sync: SyncResult, tv: float
) -> tuple[float, float, float, float]:
    """Dado un instante del VÍDEO (tv, s desde su frame 0), devuelve
    (lat, lng, alt_MSL, yaw) interpolando en el log según el offset de sync.

    Esta es la función que usa el ajustador del front: mueves el vídeo, y esto
    te dice dónde estaba el dron -> se pinta el marcador en el mapa."""
    t_log = log.t0_us + sync.video_start_trel + tv
    lat, lng, alt = log.interp_position(t_log)
    yaw = log.yaw_at(t_log)
    return lat, lng, alt, yaw
