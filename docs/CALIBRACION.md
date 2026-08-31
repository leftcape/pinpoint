# Calibración del FOV — registro por cámara y vuelo

> Rellenar cada vez que se fije un FOV visual. El valor vive en `campaign.json`
> (`config.fov`) de cada vuelo; aquí queda el resumen legible para el paper.

## Cámara: Arducam 12 MP (VTOL LeftCape), vídeo 1280×720

### FOV sfm (autocalibración)

- Origen: OpenSfM (motor de ODM), autocalibración sobre frames del vuelo de referencia.
- Focal normalizado `f = 0.6849` (fracción de max(W,H)) → `fov_h = 2·atan(0.5/f) = 72.26°`.
- Modelo de cámara de OpenSfM: pendiente de recuperar `cameras.json` (k1, k2) de aquella
  ejecución para citar la distorsión.

### FOV visual

| vuelo | fecha | método | frame (tv) | AGL | terreno | pares | GSD (m/px) | dispersión | fov_h |
|---|---|---|---|---|---|---|---|---|---|
| 1 (00000064.BIN) | — | — | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — | — | — |

Notas:
- El visual se obtiene DESPUÉS de sincronizar. El método por pares es independiente del
  offset y del yaw (usa distancias), pero el AGL del frame sí depende del terreno elegido.
- La diferencia sfm − visual es la distorsión de gran angular: se reporta, no se corrige.
