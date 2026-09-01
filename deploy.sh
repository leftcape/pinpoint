#!/bin/bash
set -e

# Despliega PinPoint (frontend+backend) en un servidor remoto.
#
# Dos modos:
#   git    (por defecto) el servidor hace `git pull` y construye. Lo desplegado
#          es exactamente lo que hay en GitHub: reproducible, y no arrastra lo
#          que tengas a medias en el portátil. Necesita que el servidor pueda
#          leer el repo (deploy key en GitHub, o URL https si es público).
#   rsync  copia tu copia de trabajo. Para probar algo sin publicarlo antes.
#
#   REMOTE_USER=u REMOTE_HOST=h ./deploy.sh              # git pull de main
#   REMOTE_USER=u REMOTE_HOST=h MODE=rsync ./deploy.sh   # copia local

# ── Configuración ─────────────────────────────────────────
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/home/luis/docker/pinpoint}"
MODE="${MODE:-git}"
GIT_REMOTE="${GIT_REMOTE:-git@github.com:leftcape/pinpoint.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ]; then
    echo "Uso: REMOTE_USER=usuario REMOTE_HOST=servidor ./deploy.sh"
    echo ""
    echo "Variables opcionales:"
    echo "  MODE         git (default) | rsync"
    echo "  REMOTE_DIR   Directorio en el servidor (default: /home/luis/docker/pinpoint)"
    echo "  GIT_REMOTE   Repo a clonar/actualizar (default: ${GIT_REMOTE})"
    echo "  GIT_BRANCH   Rama (default: main)"
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

ssh ${SSH_OPTS} "${REMOTE}" "mkdir -p ${REMOTE_DIR} ${DATA_HOST:+'$DATA_HOST'}"

if [ "$MODE" = "git" ]; then
    echo "==> Actualizando desde ${GIT_REMOTE} (${GIT_BRANCH}) en ${REMOTE}:${REMOTE_DIR} ..."
    # Clona la primera vez; después, fetch + reset --hard para que el servidor
    # quede EXACTAMENTE en el commit remoto (sin merges ni conflictos locales).
    ssh ${SSH_OPTS} "${REMOTE}" "
        set -e
        if [ -d '${REMOTE_DIR}/.git' ]; then
            cd '${REMOTE_DIR}'
            git fetch --depth 1 origin '${GIT_BRANCH}'
            git reset --hard 'origin/${GIT_BRANCH}'
        else
            # el directorio puede existir con .env y datos: clonar aparte y mover el .git
            tmp=\$(mktemp -d)
            git clone --depth 1 --branch '${GIT_BRANCH}' '${GIT_REMOTE}' \"\$tmp/repo\"
            cp -a \"\$tmp/repo/.\" '${REMOTE_DIR}/'
            rm -rf \"\$tmp\"
            cd '${REMOTE_DIR}'
        fi
        echo \"    commit: \$(git rev-parse --short HEAD) — \$(git log -1 --pretty=%s)\"
    "
else
    echo "==> Copiando ficheros a ${REMOTE}:${REMOTE_DIR} ..."
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
fi

# El .env NO va en git ni en el rsync (lleva la config de cada máquina). Si el
# servidor no tiene uno, se siembra desde .env.example para que el compose
# arranque con los valores por defecto (biblioteca y cuota incluidas).
ssh ${SSH_OPTS} "${REMOTE}" "
    cd '${REMOTE_DIR}'
    if [ ! -f .env ] && [ -f .env.example ]; then
        cp .env.example .env
        echo '    .env creado desde .env.example — revísalo si necesitas otros valores'
    fi
"

echo "==> Construyendo y levantando contenedor (build del front + backend) ..."
ssh ${SSH_OPTS} "${REMOTE}" "cd ${REMOTE_DIR} && docker compose up -d --build"

echo "==> Verificando ..."
ssh ${SSH_OPTS} "${REMOTE}" "docker ps --filter name=pinpoint --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# El puerto se lee del .env DEL SERVIDOR: el local puede ser otro.
PORT=$(ssh ${SSH_OPTS} "${REMOTE}" "grep -E '^PINPOINT_PORT=' '${REMOTE_DIR}/.env' 2>/dev/null | cut -d= -f2-")
PORT="${PORT:-8096}"

# Estado real de la biblioteca, preguntándoselo a la PROPIA app: es su usuario
# dentro del contenedor quien tiene que poder leer y escribir, no el del host.
echo "==> Comprobando la biblioteca de vuelos ..."
sleep 3   # dar tiempo a que el contenedor levante antes de preguntarle
ssh ${SSH_OPTS} "${REMOTE}" "
    curl -sf --max-time 15 http://localhost:${PORT}/api/library 2>/dev/null \
    | python3 -c \"
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('    (no se pudo consultar /api/library)'); sys.exit()
q=d['quota']
print('    ' + d['dir'])
print('    %d vídeos · %d logs · %.2f/%.0f GB (%.1f%%)' % (
    len(d['videos']), len(d['logs']), q['used']/1024**3, q['limit']/1024**3, q['pct']))
if not d['exists']: print('    ⚠ la carpeta no existe dentro del contenedor')
elif not d['writable']: print('    ⚠ solo lectura: las subidas estarán desactivadas')
else: print('    escritura: OK')
\"
"

echo "==> Despliegue completado"
echo "    PinPoint: http://${REMOTE_HOST}:${PORT:-8096}"
