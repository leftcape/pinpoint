"""
Footprint de cámara: proyecta las 4 esquinas del frame al suelo en lat/lon.

Dado (posición del dron, orientación de la cámara del gimbal, FOV, altura del
terreno), calcula el cuadrilátero que la cámara ve en el suelo. El front lo pega
en el mapa (MapLibre image source con 4 esquinas).

FASE ACTUAL: terreno plano (altura = plano a `ground_alt_msl`).

Se calculan DOS geometrías distintas, para dos usos distintos:
  - `outline_corners` (ray-casting real): la silueta que la cámara ve en el
    suelo según pitch/roll/yaw. En nadir es un rectángulo; en oblicuo es un
    TRAPECIO (borde lejano ancho, cercano estrecho). El front la usa para el
    CONTORNO — siempre refleja fielmente lo que mira la cámara.
  - `corners` (rectángulo nadir): footprint plano bajo el dron. El front la usa
    para pegar la IMAGEN, pero solo cuando `nadir_ok` (cámara suficientemente
    cenital) — deformar la foto en trapecio con MapLibre sale mal.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .binlog import BinLog
from .sync import SyncResult

# Distancia máxima al suelo para rayos casi horizontales (cámara al horizonte).
# Las esquinas que se irían al infinito se recortan aquí.
MAX_GROUND_RANGE_M = 2000.0


@dataclass
class Footprint:
    tv: float                              # instante del vídeo (s)
    drone_lat: float
    drone_lng: float
    agl: float                             # altura sobre el terreno usada (m)
    yaw: float                             # yaw de cámara (grados)
    pitch: float                           # pitch de cámara (grados; -90 = nadir)
    roll: float                            # roll de cámara (grados; 0 = nivelado)
    corners: list[tuple[float, float]]     # 4 (lat, lng) rectángulo nadir -> para la IMAGEN
    # silueta real por ray-casting (trapecio si oblicuo) -> para el CONTORNO.
    # Puede tener esquinas recortadas si la cámara mira al horizonte (ver clipped).
    outline_corners: list[tuple[float, float]] = None  # type: ignore[assignment]
    valid: bool = True                     # False si no se pudo proyectar (dron muy bajo)
    # True si la cámara está lo bastante cenital (dentro de los umbrales) como
    # para que la proyección plana del frame sea fiable. Si es False, el front
    # NO debe pintar la imagen (saldría descolocada por la perspectiva oblicua).
    nadir_ok: bool = True
    # motivo por el que NO es cenital (para informar en el front): "" | "pitch" | "roll" | "agl"
    reason: str = ""
    # True si alguna esquina del contorno se recortó (cámara mirando al horizonte)
    clipped: bool = False
    # Alabeo del DRON (informativo). NO se aplica a la geometría: la imagen de la
    # cámara va estabilizada en roll (validado con frames en curvas a -49°).
    drone_roll: float = 0.0
    # Cabeceo del DRON (ATT). Interviene en la geometría del contorno (δ =
    # mnt_pitch − drone_pitch, y Ry(θ) del cuerpo), así que se reporta para que
    # el front pueda registrarlo: es una variable del modelo, no un dato oculto.
    drone_pitch: float = 0.0


def _fov_from_focal(focal_norm: float, width: int, height: int) -> tuple[float, float]:
    """FOV (h, v) en grados a partir del focal normalizado de OpenSFM
    (focal como fracción de max(W,H))."""
    S = max(width, height)
    fov_h = 2 * math.degrees(math.atan((width / 2) / (focal_norm * S)))
    fov_v = 2 * math.degrees(math.atan((height / 2) / (focal_norm * S)))
    return fov_h, fov_v


def compute_footprint(
    log: BinLog,
    sync: SyncResult,
    tv: float,
    *,
    fov_h: float,
    fov_v: float,
    ground_alt_msl: float | None = None,
    max_pitch_dev: float = 15.0,
    max_roll_dev: float = 10.0,
    min_agl: float = 20.0,
    pitch_offset: float = 0.0,
    roll_offset: float = 0.0,
) -> Footprint:
    """Footprint del frame en el instante tv del vídeo (proyección plana nadir).

    fov_h, fov_v: campo de visión de la cámara en grados.
    ground_alt_msl: altitud del terreno (MSL). Si None, usa el punto de despegue.

    Umbrales de "cenital" (nadir_ok): la proyección plana solo es fiable si la
    cámara mira casi recto abajo. Fuera de estos márgenes, nadir_ok=False y el
    front no debe pintar la imagen (saldría descolocada):
      max_pitch_dev: desviación máx del pitch respecto a -90° (grados).
      max_roll_dev:  |roll| máximo (grados).
      min_agl:       altura mínima sobre el terreno (m).
    """
    t_log = log.t0_us + sync.video_start_trel + tv
    lat, lng, alt = log.interp_position(t_log)
    _, pitch, yaw_mnt = log.camera_orientation_at(t_log)   # pitch del gimbal (marco terrestre)
    # MODELO DE CÁMARA (validado con frames reales): el gimbal es de 1 eje y
    # solo compensa el CABECEO. En roll y yaw la cámara es SOLIDARIA al dron:
    # en curvas con alabeo ±45° los frames muestran cielo en el borde del
    # encuadre (lado contrario al ala baja). Por tanto la orientación real es
    # la composición: actitud del dron (roll, pitch, yaw del ATT) + cabeceo del
    # gimbal (MNT). NO existe estabilización electrónica de roll.
    drone_roll, drone_pitch, drone_yaw = log.drone_attitude_at(t_log)
    # Ajustes finos manuales (sliders del front): deltas sobre los ángulos
    # medidos, para calibrar a ojo contra la ortofoto (óptica, montaje, etc.)
    pitch = pitch + pitch_offset
    drone_roll = drone_roll + roll_offset
    roll = drone_roll                        # alabeo real de la cámara
    yaw = drone_yaw if log.att_t else yaw_mnt

    ground = ground_alt_msl if ground_alt_msl is not None else log.alt0
    agl = alt - ground
    if agl <= 1.0:
        # el dron está a nivel del suelo o el dato es malo: sin footprint
        return Footprint(tv, lat, lng, agl, yaw, pitch, roll, [],
                         outline_corners=[], valid=False,
                         nadir_ok=False, reason="agl",
                         drone_roll=drone_roll, drone_pitch=drone_pitch)

    # --- gate de cenital: ¿es fiable proyectar el frame plano? ---
    # pitch: del gimbal (estabilizado). roll: del DRON (no estabilizado) — en
    # curvas la cámara se ladea de verdad, así que la imagen plana no es fiable.
    pitch_dev = abs(pitch - (-90.0))
    roll_dev = abs(roll)
    nadir_ok = True
    reason = ""
    if agl < min_agl:
        nadir_ok, reason = False, "agl"
    elif pitch_dev > max_pitch_dev:
        nadir_ok, reason = False, "pitch"
    elif roll_dev > max_roll_dev:
        nadir_ok, reason = False, "roll"

    # Nadir (pitch≈-90): footprint rectangular centrado bajo el dron.
    # (para pitch muy oblicuo esto se queda corto; hoy la cámara es nadir).
    half_w = agl * math.tan(math.radians(fov_h / 2.0))   # medio ancho en m
    half_h = agl * math.tan(math.radians(fov_v / 2.0))   # medio alto en m

    # metros -> grados en este punto
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * math.cos(math.radians(lat))

    yaw_rad = math.radians(yaw)
    cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)

    # Sensor: sx = eje horizontal de la imagen (derecha), sy = eje vertical
    # (arriba de la imagen = hacia el morro = dirección de apuntamiento del yaw).
    # CONVENCIÓN yaw NAVEGACIÓN: 0°=Norte, horario (90°=Este). Por tanto:
    #   "adelante" (0, d)   -> (E,N) = ( d·sin(yaw),  d·cos(yaw))
    #   "derecha"  (d, 0)   -> (E,N) = ( d·cos(yaw), -d·sin(yaw))
    # => east  =  sx·cos(yaw) + sy·sin(yaw)
    #    north = -sx·sin(yaw) + sy·cos(yaw)
    # orden TL, TR, BR, BL respecto a la imagen
    sensor = [(-half_w, half_h), (half_w, half_h), (half_w, -half_h), (-half_w, -half_h)]
    corners = []
    for sx, sy in sensor:
        east = sx * cos_y + sy * sin_y
        north = -sx * sin_y + sy * cos_y
        corners.append((lat + north / m_per_deg_lat, lng + east / m_per_deg_lng))

    # --- CONTORNO real por RAY-CASTING con actitud completa ---
    # Composición: R = Rz(yaw_dron)·Ry(pitch_dron)·Rx(roll_dron)·Ry(δ_gimbal),
    # con δ_gimbal = pitch_MNT − pitch_dron (el gimbal compensa solo el cabeceo,
    # de modo que a alabeo 0 el cabeceo terrestre de la cámara = MNT.Pitch).
    # Nivelado y nadir → rectángulo; cámara al frente → trapecio frontal;
    # curva alabeada → trapecio lateral (cielo/recorte hacia el ala alta).
    outline_corners, clipped, _caster = _raycast_outline(
        lat, lng, agl, fov_h, fov_v,
        drone_yaw if log.att_t else yaw, drone_pitch, drone_roll, pitch,
        m_per_deg_lat, m_per_deg_lng,
    )

    return Footprint(tv, lat, lng, agl, yaw, pitch, roll, corners,
                     outline_corners=outline_corners, valid=True,
                     nadir_ok=nadir_ok, reason=reason, clipped=clipped,
                     drone_roll=drone_roll, drone_pitch=drone_pitch)


def _raycast_outline(lat, lng, agl, fov_h, fov_v,
                     drone_yaw, drone_pitch, drone_roll, mnt_pitch,
                     m_per_deg_lat, m_per_deg_lng):
    """4 esquinas (lat,lng) de la silueta real en el suelo, con ACTITUD COMPLETA.

    Marco NED (x=Norte, y=Este, z=Abajo). Composición cuerpo→mundo aeroespacial
    estándar R = Rz(ψ)·Ry(θ)·Rx(φ), y el gimbal como rotación extra de cabeceo
    dentro del cuerpo: δ = mnt_pitch − θ (el gimbal compensa solo el cabeceo del
    dron, así a alabeo 0 el cabeceo terrestre de la cámara = mnt_pitch).

    Validación empírica del signo del alabeo: con φ≈−45° (ala izquierda baja)
    los frames muestran CIELO en el borde DERECHO de la imagen -> los rayos del
    lado derecho del sensor deben salir menos picados (comprobado en tests).

    Devuelve (corners TL,TR,BR,BL, clipped)."""
    hw = math.tan(math.radians(fov_h / 2.0))
    hh = math.tan(math.radians(fov_v / 2.0))
    psi = math.radians(drone_yaw)      # rumbo: 0=N, horario
    th = math.radians(drone_pitch)     # cabeceo dron: + = morro arriba
    ph = math.radians(drone_roll)      # alabeo dron: + = ala derecha baja
    dlt = math.radians(mnt_pitch - drone_pitch)  # cabeceo del gimbal (relativo al cuerpo)

    cps, sps = math.cos(psi), math.sin(psi)
    cth, sth = math.cos(th), math.sin(th)
    cph, sph = math.cos(ph), math.sin(ph)
    cd, sd = math.cos(dlt), math.sin(dlt)

    # R_wb = Rz(ψ)·Ry(θ)·Rx(φ)  (cuerpo→mundo NED, filas x=N, y=E, z=Down)
    R = (
        (cps * cth, cps * sth * sph - sps * cph, cps * sth * cph + sps * sph),
        (sps * cth, sps * sth * sph + cps * cph, sps * sth * cph - cps * sph),
        (-sth,      cth * sph,                   cth * cph),
    )

    # base de la cámara en el CUERPO (x=adelante, y=derecha, z=abajo):
    #   adelante_cam = Ry(δ)·x̂ = (cosδ, 0, −sinδ)   [δ=−90 → (0,0,1) = abajo ✓]
    #   arriba-imagen = Ry(δ)·(−ẑ) = (−sinδ, 0, −cosδ) [δ=−90 → (1,0,0) = morro ✓]
    #   derecha-imagen = ŷ
    fwd_b = (cd, 0.0, -sd)
    up_b = (-sd, 0.0, -cd)
    right_b = (0.0, 1.0, 0.0)

    # (u, v) en coords normalizadas del sensor: u = derecha-img, v = arriba-img,
    # ambos en [-hw..hw] / [-hh..hh] (centro = 0). Un rayo por esquina.
    def cast(u, v):
        rb = (
            fwd_b[0] + u * right_b[0] + v * up_b[0],
            fwd_b[1] + u * right_b[1] + v * up_b[1],
            fwd_b[2] + u * right_b[2] + v * up_b[2],
        )
        rn = R[0][0] * rb[0] + R[0][1] * rb[1] + R[0][2] * rb[2]   # Norte
        re = R[1][0] * rb[0] + R[1][1] * rb[1] + R[1][2] * rb[2]   # Este
        rd = R[2][0] * rb[0] + R[2][1] * rb[1] + R[2][2] * rb[2]   # Abajo
        clip = False
        if rd <= 1e-6:
            clip = True
            s = MAX_GROUND_RANGE_M
        else:
            s = agl / rd
            if s > MAX_GROUND_RANGE_M:
                s = MAX_GROUND_RANGE_M
                clip = True
        return (lat + (rn * s) / m_per_deg_lat, lng + (re * s) / m_per_deg_lng), clip

    # esquinas del sensor: TL, TR, BR, BL
    out = []
    clipped = False
    for u, v in [(-hw, hh), (hw, hh), (hw, -hh), (-hw, -hh)]:
        pt, clip = cast(u, v)
        out.append(pt)
        clipped = clipped or clip
    # devolvemos también la función cast para proyectar píxeles arbitrarios
    return out, clipped, (cast, hw, hh)


def project_pixel(
    log: BinLog,
    sync: SyncResult,
    tv: float,
    px: float,
    py: float,
    img_w: float,
    img_h: float,
    *,
    fov_h: float,
    fov_v: float,
    ground_alt_msl: float | None = None,
    pitch_offset: float = 0.0,
    roll_offset: float = 0.0,
    ortho: bool = False,
) -> dict:
    """Proyecta un píxel (px,py) de la imagen (tamaño img_w×img_h, origen arriba-
    izquierda) al suelo, con la MISMA geometría de actitud completa que el
    contorno. Devuelve {lat, lng, clipped, valid}.

    ortho=True: cancela la ACTITUD (pitch/roll del dron a 0, gimbal a nadir
    exacto) manteniendo el yaw, la altura y el FOV. Es la geometría del
    RECTÁNGULO nadir (`corners`) — la misma que pinta "Project the frame image"
    — expresada como pinhole puro. Sirve de línea base para medir cuánto aporta
    la corrección de actitud.

    NOTA: esto NO es equivalente a pasar pitch_offset/roll_offset para llevar los
    ángulos a nadir. Esos deltas se suman al pitch del GIMBAL y al roll del DRON,
    pero el cabeceo del dron (θ en Ry(θ), y dentro de δ = mnt_pitch − θ) no es
    alcanzable desde fuera: con el dron cabeceado nunca se llega a nadir perfecto
    por esa vía. De ahí este parámetro explícito.

    Reutiliza el `cast` interno de _raycast_outline para no duplicar la mate."""
    t_log = log.t0_us + sync.video_start_trel + tv
    lat, lng, alt = log.interp_position(t_log)
    _, pitch, yaw_mnt = log.camera_orientation_at(t_log)
    drone_roll, drone_pitch, drone_yaw = log.drone_attitude_at(t_log)
    pitch = pitch + pitch_offset
    drone_roll = drone_roll + roll_offset

    ground = ground_alt_msl if ground_alt_msl is not None else log.alt0
    agl = alt - ground
    if agl <= 1.0:
        return {"lat": lat, "lng": lng, "clipped": False, "valid": False}

    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * math.cos(math.radians(lat))
    yaw = drone_yaw if log.att_t else yaw_mnt

    if ortho:
        # cámara colgada en nadir perfecto bajo el dron: sin cabeceo ni alabeo
        # del cuerpo, y gimbal apuntando recto abajo (δ = −90 − 0 = −90).
        drone_pitch, drone_roll, pitch = 0.0, 0.0, -90.0

    _, _, (cast, hw, hh) = _raycast_outline(
        lat, lng, agl, fov_h, fov_v, yaw, drone_pitch, drone_roll, pitch,
        m_per_deg_lat, m_per_deg_lng,
    )

    # píxel (origen arriba-izq) -> coords normalizadas del sensor:
    #   u = derecha-img (centro 0), v = arriba-img (centro 0)
    u = (px / img_w - 0.5) * 2.0 * hw
    v = (0.5 - py / img_h) * 2.0 * hh
    (glat, glng), clip = cast(u, v)
    return {"lat": glat, "lng": glng, "clipped": clip, "valid": True}
