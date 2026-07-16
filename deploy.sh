#!/bin/bash
set -e

# Despliega PinPoint (frontend+backend) en un servidor remoto.
# Patrón: rsync del código + docker compose up --build, vía SSH.

# ── Configuración ─────────────────────────────────────────
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/home/luis/docker/pinpoint}"

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ]; then
    echo "Uso: REMOTE_USER=usuario REMOTE_HOST=servidor ./deploy.sh"
    echo ""
    echo "Variables opcionales:"
    echo "  REMOTE_DIR   Directorio en el servidor (default: /home/luis/docker/pinpoint)"
    exit 1
fi

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Conexión SSH compartida (una sola password) ──────────
SSH_SOCKET="/tmp/deploy-pinpoint-$$"
SSH_OPTS="-o ControlMaster=auto -o ControlPath=${SSH_SOCKET} -o ControlPersist=60"

echo "==> Conectando a ${REMOTE} ..."
ssh ${SSH_OPTS} "${REMOTE}" "echo 'Conexión OK'"
cleanup() { ssh -O exit -o ControlPath="${SSH_SOCKET}" "${REMOTE}" 2>/dev/null || true; }
trap cleanup EXIT

REMOTE_DIR=$(ssh ${SSH_OPTS} "${REMOTE}" "echo ${REMOTE_DIR}")

# ── Carpeta de datos (PINPOINT_DATA_HOST del .env) ───────
DATA_HOST=$(grep -E '^PINPOINT_DATA_HOST=' "$SCRIPT_DIR/.env" | cut -d= -f2-)

echo "==> Copiando ficheros a ${REMOTE}:${REMOTE_DIR} ..."
ssh ${SSH_OPTS} "${REMOTE}" "mkdir -p ${REMOTE_DIR} ${DATA_HOST:+'$DATA_HOST'}"

# Copiamos el código fuente. Excluimos node_modules/dist (se construyen en el
# servidor) y los datos de trabajo.
# --delete: borra en el servidor lo que ya no exista en local (p.ej. un componente
# eliminado), o quedaría como fichero fantasma y rompería el build.
rsync -avz --delete -e "ssh ${SSH_OPTS}" \
    --exclude='web/node_modules' \
    --exclude='web/dist' \
    --exclude='__pycache__' \
    --exclude='pinpoint-data' \
    --exclude='.git' \
    --exclude='.env' \
    "$SCRIPT_DIR/" "${REMOTE}:${REMOTE_DIR}/"

echo "==> Construyendo y levantando contenedor (build del front + backend) ..."
ssh ${SSH_OPTS} "${REMOTE}" "cd ${REMOTE_DIR} && docker compose up -d --build"

echo "==> Verificando ..."
ssh ${SSH_OPTS} "${REMOTE}" "docker ps --filter name=pinpoint --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

PORT=$(grep -E '^PINPOINT_PORT=' "$SCRIPT_DIR/.env" | cut -d= -f2-)
echo "==> Despliegue completado"
echo "    PinPoint: http://${REMOTE_HOST}:${PORT:-8096}"
