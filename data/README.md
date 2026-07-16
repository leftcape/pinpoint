# Datos de ejemplo

Para reproducir los resultados del artículo hace falta un vuelo de ejemplo: un
log de ArduPilot (`.bin`) y su vídeo (`.mkv`/`.mp4`). Estos ficheros pesan
demasiado para versionarlos en el repositorio, así que se distribuyen aparte.

## Descarga

> **PENDIENTE.** Aquí irá el enlace externo de descarga del dataset de ejemplo
> (por decidir: Zenodo, un enlace institucional, u otro repositorio de datos).
> Recomendación: Zenodo, porque da un DOI citable y encaja con CC BY-NC.

Una vez descargado, coloca los ficheros donde prefieras y regístralos en la app
por su ruta (modo "Ruta en servidor") o súbelos desde el navegador.

## Qué debe contener el dataset

- El `.bin` del vuelo (log de ArduPilot con mensajes GPS, ATT y MNT).
- El vídeo del vuelo, preferiblemente el original `.mkv` (conserva el
  `creation_time`; un `.mp4` recodificado suele perderlo y solo se podría
  sincronizar por despegue o manualmente).
- Opcional: una tabla de puntos de control ya medidos, para comparar.

## Licencia de los datos

Los datos de ejemplo se publican bajo CC BY-NC 4.0 (ver `LICENSE-docs`).
