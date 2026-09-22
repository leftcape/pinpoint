"""Fiabilidad de una coordenada: ángulo de visión y bandas.

Es el "criterio por punto" del artículo (Método, «Criterio por punto: el
ángulo de visión»). La variable que gobierna la exactitud de un punto no es
el alabeo del dron sino el ÁNGULO DE VISIÓN bajo el que la cámara lo observa:

    theta = arctan(d_nadir / AGL)

con d_nadir la distancia sobre el terreno entre el punto proyectado y la
vertical de la aeronave. Combina la inclinación de la cámara con la posición
del píxel en el encuadre: un punto en el borde de un fotograma cenital y uno
central en oblicuo tienen el mismo theta, y merecen la misma confianza.

BANDAS. Tres bandas por theta, cada una con el MARGEN que cabe esperar,
expresado como percentil 90 del error medido en la campaña del vuelo 1 del
artículo (100 puntos de control, proyección con actitud completa, ~119 m AGL):

    A  fiable        0–15°   P90 = 10 m   (mediana  7.8 m, n = 15)
    B  degradada    15–45°   P90 = 22 m   (mediana 11.5 m, n = 52)
    C  orientativa  45–90°   P90 = 116 m  (mediana 30.8 m, n = 33)

Los márgenes son EMPÍRICOS y de esa campaña: no se escalan con la altura ni
con la plataforma (decisión 2026-09-22: lo publicado es lo trazable; la
mediana/altura no sale constante entre los dos vuelos, 0.066 frente a 0.081,
así que escalar sería extrapolar). theta y AGL se devuelven junto a la banda
para que quien recibe la coordenada pueda juzgar por sí mismo.

Modelo de referencia del artículo (NO se usa para el margen, solo se expone):
eps(theta) ≈ eps0 / cos²(theta), con eps0 la mediana en la banda A.

DE DÓNDE SALE d_nadir. En la herramienta, del punto PROYECTADO: es lo único
que se conoce en campo. En el análisis del artículo la tabla se construyó con
la posición de VERDAD-TERRENO de cada GCP. Verificado el 2026-09-22 sobre los
100 puntos del vuelo 1: con la verdad-terreno este código reproduce la tabla
exactamente (15/52/33); con el punto proyectado da 16/54/30, porque el propio
error de proyección mueve d_nadir en los puntos que caen junto a un límite de
banda. La diferencia es inherente al uso operativo y se acepta.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Band:
    code: str          # "A" | "B" | "C"
    theta_min: float   # grados, inclusive
    theta_max: float   # grados, exclusivo (salvo la última)
    margin_p90_m: float
    median_m: float
    n: int


# Tabla de bandas de fiabilidad del artículo (vuelo 1, actitud completa).
BANDS: tuple[Band, ...] = (
    Band("A", 0.0, 15.0, 10.0, 7.8, 15),
    Band("B", 15.0, 45.0, 22.0, 11.5, 52),
    Band("C", 45.0, 90.0, 116.0, 30.8, 33),
)

# Origen de la tabla, para que el front y el CSV lo puedan declarar.
BANDS_SOURCE = "P90 empírico, campaña vuelo 1 del artículo (100 GCP, ~119 m AGL)"


def view_angle_deg(d_nadir_m: float, agl_m: float) -> float:
    """theta = arctan(d_nadir / AGL), en grados. AGL <= 0 -> 90 (horizonte)."""
    if agl_m <= 0.0:
        return 90.0
    return math.degrees(math.atan2(max(d_nadir_m, 0.0), agl_m))


def band_for(theta_deg: float) -> Band:
    """Banda a la que pertenece un ángulo de visión. Fuera de [0, 90] se topa."""
    th = min(max(theta_deg, 0.0), 90.0)
    for b in BANDS:
        if th < b.theta_max:
            return b
    return BANDS[-1]


def model_error_m(theta_deg: float, eps0_m: float = BANDS[0].median_m) -> float:
    """eps(theta) ≈ eps0 / cos²theta: la ley de degradación del artículo. Solo
    informativo; el margen que se entrega es el P90 empírico de la banda."""
    c = math.cos(math.radians(min(theta_deg, 89.0)))
    return eps0_m / (c * c)


def qualify(d_nadir_m: float, agl_m: float) -> dict:
    """Todo lo que acompaña a una coordenada: theta, banda y margen."""
    theta = view_angle_deg(d_nadir_m, agl_m)
    b = band_for(theta)
    return {
        "theta_deg": theta,
        "d_nadir_m": d_nadir_m,
        "agl_m": agl_m,
        "band": b.code,
        "margin_p90_m": b.margin_p90_m,
        "model_err_m": model_error_m(theta),
    }
