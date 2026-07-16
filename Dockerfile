# PinPoint — imagen multi-stage: build del front (node) + backend Python con ffmpeg.
#
# Contexto de build esperado: la raíz del repo.
#   docker build -t pinpoint .

# ---------- stage 1: front ----------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build          # -> /web/dist

# ---------- stage 2: backend ----------
FROM python:3.12-slim

# ffmpeg/ffprobe son binarios de sistema que el núcleo necesita
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# núcleo + server
COPY pinpoint_core ./pinpoint_core
COPY server ./server

# front ya construido (el server lo sirve desde ../web/dist relativo a server/)
COPY --from=web /web/dist ./web/dist

EXPOSE 8000

# PINPOINT_DATA: fuentes registradas/subidas (bin + vídeo).
ENV PINPOINT_DATA=/pinpoint-data

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
