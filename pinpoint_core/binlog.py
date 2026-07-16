"""
Parseo de logs .bin de ArduPilot (DataFlash).

Extrae la trayectoria (GPS) y la actitud (ATT) y las deja como series
temporales ordenadas por el tiempo interno del autopiloto (TimeUS, en
microsegundos desde el arranque). También reconstruye el tiempo UTC real a
partir del reloj GPS (GWk/GMS), que es la referencia infalible para sincronizar
con el vídeo.

Descubrimientos que este módulo encapsula:
  - El reloj GPS del log es UTC verdadero (viene de los satélites). El
    creation_time del vídeo suele estar en hora LOCAL etiquetada como UTC, de
    ahí el típico desfase de zona horaria (ver sync.py).
  - El despegue se detecta como el primer instante con altura relativa > umbral
    y velocidad > umbral. En el vuelo de referencia cayó en t_rel≈21.2 s.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# Segundos de salto GPS-UTC. 18 s es correcto desde 2017 y sigue vigente en 2026.
GPS_UTC_LEAP_SECONDS = 18
GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def gps_week_ms_to_utc(gps_week: int, gps_ms: int) -> datetime:
    """Convierte (semana GPS, ms de la semana) a datetime UTC real."""
    return (
        GPS_EPOCH
        + timedelta(weeks=gps_week, milliseconds=gps_ms)
        - timedelta(seconds=GPS_UTC_LEAP_SECONDS)
    )


@dataclass
class GpsFix:
    t_us: float          # TimeUS del autopiloto (s, ya dividido por 1e6)
    lat: float
    lng: float
    alt: float           # altitud MSL (m)
    utc: datetime        # tiempo UTC real reconstruido del reloj GPS
    spd: float = 0.0     # velocidad sobre el suelo (m/s)
    nsats: int = 0
    hdop: float = 0.0


@dataclass
class BinLog:
    """Log parseado, listo para consultar/interpolar."""

    gps: list[GpsFix] = field(default_factory=list)
    # actitud: listas paralelas t_us (s) y yaw (grados 0..360)
    att_t: list[float] = field(default_factory=list)
    att_yaw: list[float] = field(default_factory=list)
    att_roll: list[float] = field(default_factory=list)    # alabeo del DRON (grados)
    att_pitch: list[float] = field(default_factory=list)   # cabeceo del DRON (grados)
    # gimbal (MNT): listas paralelas t_us (s), roll, pitch, yaw-earth (grados)
    # pitch≈-90 = cámara nadir (mirando al suelo). Vacío si el log no tiene MNT.
    mnt_t: list[float] = field(default_factory=list)
    mnt_roll: list[float] = field(default_factory=list)
    mnt_pitch: list[float] = field(default_factory=list)
    mnt_yaw: list[float] = field(default_factory=list)

    # --- propiedades derivadas ---
    @property
    def t0_us(self) -> float:
        """TimeUS (s) del primer fix GPS válido = origen del tiempo relativo."""
        return self.gps[0].t_us

    @property
    def alt0(self) -> float:
        """Altitud MSL del primer fix = referencia para altura relativa."""
        return self.gps[0].alt

    @property
    def duration_s(self) -> float:
        return self.gps[-1].t_us - self.gps[0].t_us

    @property
    def utc_start(self) -> datetime:
        return self.gps[0].utc

    @property
    def utc_end(self) -> datetime:
        return self.gps[-1].utc

    def bbox(self) -> tuple[float, float, float, float]:
        """(min_lat, min_lng, max_lat, max_lng)."""
        lats = [g.lat for g in self.gps]
        lngs = [g.lng for g in self.gps]
        return min(lats), min(lngs), max(lats), max(lngs)

    # --- consultas por tiempo absoluto del log (t_us en segundos) ---
    def _gps_index(self) -> list[float]:
        # cacheado perezosamente para bisect
        if not hasattr(self, "_gt_cache"):
            self._gt_cache = [g.t_us for g in self.gps]
        return self._gt_cache

    def interp_position(self, t_us: float) -> tuple[float, float, float]:
        """Interpola (lat, lng, alt_MSL) linealmente en el instante t_us (s)."""
        gt = self._gps_index()
        i = bisect.bisect_left(gt, t_us)
        if i <= 0:
            g = self.gps[0]
            return g.lat, g.lng, g.alt
        if i >= len(self.gps):
            g = self.gps[-1]
            return g.lat, g.lng, g.alt
        a, b = self.gps[i - 1], self.gps[i]
        span = b.t_us - a.t_us
        f = (t_us - a.t_us) / span if span > 0 else 0.0
        return (
            a.lat + (b.lat - a.lat) * f,
            a.lng + (b.lng - a.lng) * f,
            a.alt + (b.alt - a.alt) * f,
        )

    def yaw_at(self, t_us: float) -> float:
        """Yaw (grados) más cercano al instante t_us. Nearest, no interpolado:
        evita el salto de wrap 359->0 que produciría un promedio absurdo."""
        if not self.att_t:
            return 0.0
        i = bisect.bisect_left(self.att_t, t_us)
        i = max(0, min(i, len(self.att_yaw) - 1))
        return self.att_yaw[i]

    @property
    def has_gimbal(self) -> bool:
        return len(self.mnt_t) > 0

    def camera_orientation_at(self, t_us: float) -> tuple[float, float, float]:
        """Orientación de la CÁMARA (roll, pitch, yaw en grados, marco terrestre)
        en el instante t_us. Usa el gimbal (MNT) si existe; si no, cae a la
        actitud del dron (roll/pitch 0, yaw del ATT) asumiendo cámara nadir fija.
        Nearest (no interpolado) para evitar el wrap del yaw."""
        if self.has_gimbal:
            i = bisect.bisect_left(self.mnt_t, t_us)
            i = max(0, min(i, len(self.mnt_t) - 1))
            return self.mnt_roll[i], self.mnt_pitch[i], self.mnt_yaw[i]
        # sin gimbal: asumir cámara mirando abajo, yaw = yaw del dron
        return 0.0, -90.0, self.yaw_at(t_us)

    def drone_attitude_at(self, t_us: float) -> tuple[float, float, float]:
        """Actitud del DRON (roll, pitch, yaw en grados) en el instante t_us.
        Como el gimbal es de 1 eje (solo cabeceo), la cámara es solidaria al
        dron en roll y yaw: el alabeo del dron ES el alabeo real de la cámara
        (validado con frames: en curvas a ±45° aparece cielo en el borde del
        encuadre). Nearest (no interpolado, evita el wrap del yaw)."""
        if not self.att_t:
            return 0.0, 0.0, 0.0
        i = bisect.bisect_left(self.att_t, t_us)
        i = max(0, min(i, len(self.att_t) - 1))
        return self.att_roll[i], self.att_pitch[i], self.att_yaw[i]

    def altitude_profile(self, step: int = 1) -> list[tuple[float, float, float]]:
        """Perfil (t_rel_s, alt_rel_m, spd) submuestreado cada `step` fixes.
        Para el previsualizador de log del front."""
        out = []
        for g in self.gps[::step]:
            out.append((g.t_us - self.t0_us, g.alt - self.alt0, g.spd))
        return out

    def to_geojson(self, step: int = 1) -> dict:
        """Trayectoria como LineString GeoJSON (para pintarla en MapLibre)."""
        coords = [[g.lng, g.lat] for g in self.gps[::step]]
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "duration_s": self.duration_s,
                "utc_start": self.utc_start.isoformat(),
                "utc_end": self.utc_end.isoformat(),
            },
        }

    def detect_takeoff(
        self, min_alt_rel: float = 3.0, min_spd: float = 1.0
    ) -> float | None:
        """Instante RELATIVO (s desde el primer fix) del despegue: primer fix con
        altura relativa > min_alt_rel y velocidad > min_spd. None si no se detecta.

        En el vuelo de referencia esto devolvió ~21.2 s, que resultó coincidir al
        segundo con el creation_time del vídeo (el vídeo arrancó en el despegue)."""
        for g in self.gps:
            if (g.alt - self.alt0) > min_alt_rel and g.spd > min_spd:
                return g.t_us - self.t0_us
        return None


def parse_bin(path: str) -> BinLog:
    """Parsea un .bin de ArduPilot y devuelve un BinLog.

    Solo requiere pymavlink. Filtra los GPS a fix 3D (Status >= 3)."""
    from pymavlink import mavutil

    conn = mavutil.mavlink_connection(path)
    log = BinLog()
    while True:
        msg = conn.recv_match(type=["GPS", "ATT", "MNT"])
        if msg is None:
            break
        mtype = msg.get_type()
        d = msg.to_dict()
        if mtype == "GPS":
            if d.get("Status", 0) >= 3:
                log.gps.append(
                    GpsFix(
                        t_us=d["TimeUS"] / 1e6,
                        lat=d["Lat"],
                        lng=d["Lng"],
                        alt=d["Alt"],
                        utc=gps_week_ms_to_utc(d["GWk"], d["GMS"]),
                        spd=d.get("Spd", 0.0),
                        nsats=d.get("NSats", 0),
                        hdop=d.get("HDop", 0.0),
                    )
                )
        elif mtype == "ATT":
            log.att_t.append(d["TimeUS"] / 1e6)
            log.att_yaw.append(d["Yaw"])
            log.att_roll.append(d.get("Roll", 0.0))
            log.att_pitch.append(d.get("Pitch", 0.0))
        else:  # MNT (gimbal)
            # YawE = yaw en marco terrestre (earth); si es NaN caer a YawB (body)
            yaw_e = d.get("YawE")
            if yaw_e is None or (isinstance(yaw_e, float) and yaw_e != yaw_e):
                yaw_e = d.get("YawB", 0.0)
            log.mnt_t.append(d["TimeUS"] / 1e6)
            log.mnt_roll.append(d.get("Roll", 0.0))
            log.mnt_pitch.append(d.get("Pitch", -90.0))
            log.mnt_yaw.append(yaw_e)

    if not log.gps:
        raise ValueError(
            f"No se encontraron fixes GPS 3D en {path}. "
            "¿El vuelo tuvo cobertura GPS? ¿Es un .bin de ArduPilot?"
        )
    return log
