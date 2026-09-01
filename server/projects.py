"""Proyectos: la unidad de trabajo de PinPoint.

Un proyecto agrupa TODO lo de un vuelo — vídeo, log, configuración, puntos de
control y metadatos — bajo una identidad propia y estable.

Por qué existe: antes la campaña se indexaba por un hash de las RUTAS del bin y
del vídeo. Renombrar un fichero cambiaba el hash y la campaña quedaba
huérfana (pasó de verdad: 100 puntos marcados dejaron de aparecer al renombrar
los vuelos). El id de un proyecto no depende de dónde estén los ficheros ni de
cómo se llamen: se pueden mover o reemplazar sin perder el trabajo.

Lectura pública, escritura protegida: cada proyecto guarda el *hash* de una
contraseña (PBKDF2-SHA256 con sal). El texto de la contraseña no se guarda
nunca, y ni el hash ni la sal salen jamás por la API — si salieran, la
protección sería decorativa, porque cualquiera puede leer un proyecto público.

Un proyecto sin contraseña es abierto a escritura: es el caso de uso de una
instancia en red privada.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# PBKDF2 con estos parámetros: sobrado para el modelo de amenaza (proteger de
# escrituras accidentales o de un curioso), y sin dependencias nuevas.
_ITERACIONES = 200_000
_ALGO = "sha256"


def hash_password(password: str) -> dict:
    """Devuelve el material a guardar. NUNCA incluye el texto de la contraseña."""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(_ALGO, password.encode(), bytes.fromhex(salt), _ITERACIONES)
    return {"algo": _ALGO, "iter": _ITERACIONES, "salt": salt, "hash": dk.hex()}


def check_password(password: str, guardado: dict | None) -> bool:
    """Comprueba la contraseña en tiempo constante.

    Sin material guardado el proyecto es abierto: cualquier escritura vale.
    """
    if not guardado:
        return True
    try:
        dk = hashlib.pbkdf2_hmac(
            guardado.get("algo", _ALGO),
            (password or "").encode(),
            bytes.fromhex(guardado["salt"]),
            int(guardado.get("iter", _ITERACIONES)),
        )
        return hmac.compare_digest(dk.hex(), guardado["hash"])
    except Exception:
        return False


def slug(texto: str) -> str:
    """Identificador legible a partir del nombre ('Vuelo 2 · río' -> 'vuelo-2-rio')."""
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return t[:48] or "proyecto"


@dataclass
class Project:
    id: str
    name: str
    bin_path: str = ""
    video_path: str = ""
    # notas y metadatos del vuelo (sitio, fecha, AGL, relieve, cámara…). El
    # servidor no los interpreta: son del usuario y viajan en el export.
    meta: dict = field(default_factory=dict)
    created_at: float = 0.0
    updated_at: float = 0.0
    # material de la contraseña. Se guarda en disco, NO se expone nunca.
    auth: dict | None = None

    def public(self, extra: dict | None = None) -> dict:
        """Vista pública: todo salvo el material de la contraseña."""
        d = {
            "id": self.id,
            "name": self.name,
            "bin_path": self.bin_path,
            "video_path": self.video_path,
            "meta": self.meta,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "protected": bool(self.auth),   # si pide contraseña para escribir
        }
        if extra:
            d.update(extra)
        return d


class ProjectStore:
    """Proyectos en disco, uno por carpeta: `<id>/project.json` + `campaign.json`."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    # --- rutas ---
    def dir(self, pid: str) -> Path:
        # el id se genera aquí y se valida al leer: nunca viene crudo del cliente
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", pid or ""):
            raise ValueError(f"id de proyecto inválido: {pid!r}")
        return self.root / pid

    def _meta_path(self, pid: str) -> Path:
        return self.dir(pid) / "project.json"

    def campaign_path(self, pid: str) -> Path:
        return self.dir(pid) / "campaign.json"

    # --- lectura ---
    def get(self, pid: str) -> Project | None:
        try:
            p = self._meta_path(pid)
        except ValueError:
            return None
        if not p.exists():
            return None
        try:
            d = json.loads(p.read_text())
        except Exception:
            return None
        return Project(
            id=d.get("id", pid), name=d.get("name", pid),
            bin_path=d.get("bin_path", ""), video_path=d.get("video_path", ""),
            meta=d.get("meta", {}) or {},
            created_at=d.get("created_at", 0.0), updated_at=d.get("updated_at", 0.0),
            auth=d.get("auth"),
        )

    def list(self) -> list[Project]:
        out = []
        for d in sorted(self.root.iterdir() if self.root.is_dir() else []):
            if d.is_dir():
                pr = self.get(d.name)
                if pr:
                    out.append(pr)
        out.sort(key=lambda p: p.updated_at or p.created_at, reverse=True)
        return out

    def points_count(self, pid: str) -> int:
        p = self.campaign_path(pid)
        if not p.exists():
            return 0
        try:
            c = json.loads(p.read_text())
            return sum(len(f.get("points", [])) for f in c.get("frames", []))
        except Exception:
            return 0

    # --- escritura ---
    def _save(self, pr: Project) -> None:
        pr.updated_at = time.time()
        d = self.dir(pr.id)
        d.mkdir(parents=True, exist_ok=True)
        payload = {
            "id": pr.id, "name": pr.name,
            "bin_path": pr.bin_path, "video_path": pr.video_path,
            "meta": pr.meta,
            "created_at": pr.created_at, "updated_at": pr.updated_at,
        }
        if pr.auth:
            payload["auth"] = pr.auth
        tmp = self._meta_path(pr.id).with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        tmp.replace(self._meta_path(pr.id))   # atómico: nunca a medias

    def create(self, name: str, bin_path: str = "", video_path: str = "",
               password: str = "", meta: dict | None = None) -> Project:
        base = slug(name)
        pid, n = base, 2
        while (self.root / pid).exists():       # colisión de nombre -> sufijo
            pid, n = f"{base}-{n}", n + 1
        pr = Project(
            id=pid, name=name or pid, bin_path=bin_path, video_path=video_path,
            meta=meta or {}, created_at=time.time(),
            auth=hash_password(password) if password else None,
        )
        self._save(pr)
        return pr

    def update(self, pr: Project, cambios: dict) -> Project:
        for campo in ("name", "bin_path", "video_path"):
            if campo in cambios and cambios[campo] is not None:
                setattr(pr, campo, cambios[campo])
        if isinstance(cambios.get("meta"), dict):
            pr.meta = cambios["meta"]
        # cambiar la contraseña: "" la quita (proyecto abierto)
        if "new_password" in cambios and cambios["new_password"] is not None:
            nueva = cambios["new_password"]
            pr.auth = hash_password(nueva) if nueva else None
        self._save(pr)
        return pr

    # Cuántas copias de seguridad de la campaña se conservan por proyecto.
    BACKUPS = 10

    def _respaldar(self, pid: str) -> None:
        """Copia la campaña actual antes de sobrescribirla.

        Una campaña son horas de marcado y el PUT la reemplaza entera: un fallo
        del front o una pestaña vieja pueden dejarla en nada. Con esto siempre
        se puede volver atrás. Se rotan las últimas BACKUPS.
        """
        p = self.campaign_path(pid)
        if not p.exists():
            return
        bdir = self.dir(pid) / "backups"
        bdir.mkdir(parents=True, exist_ok=True)
        sello = time.strftime("%Y%m%d-%H%M%S")
        try:
            (bdir / f"campaign-{sello}.json").write_bytes(p.read_bytes())
        except OSError:
            return
        copias = sorted(bdir.glob("campaign-*.json"))
        for viejo in copias[:-self.BACKUPS]:
            viejo.unlink(missing_ok=True)

    def save_campaign(self, pid: str, campaign: dict) -> dict:
        p = self.campaign_path(pid)
        p.parent.mkdir(parents=True, exist_ok=True)
        antes = self.points_count(pid)
        self._respaldar(pid)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(campaign, ensure_ascii=False, indent=1))
        tmp.replace(p)
        n = sum(len(f.get("points", [])) for f in campaign.get("frames", []))
        r = {"frames": len(campaign.get("frames", [])), "points": n}
        # Avisar de una pérdida grande: el cliente puede enseñarlo y el usuario
        # se entera en el momento, no tres días después.
        if antes and n < antes * 0.5:
            r["warning"] = f"la campaña pasó de {antes} a {n} puntos; hay copia en backups/"
        return r

    def list_backups(self, pid: str) -> list[dict]:
        bdir = self.dir(pid) / "backups"
        if not bdir.is_dir():
            return []
        out = []
        for f in sorted(bdir.glob("campaign-*.json"), reverse=True):
            try:
                c = json.loads(f.read_text())
                out.append({
                    "name": f.name,
                    "when": f.stat().st_mtime,
                    "points": sum(len(fr.get("points", [])) for fr in c.get("frames", [])),
                })
            except Exception:
                continue
        return out

    def restore_backup(self, pid: str, nombre: str) -> dict:
        """Recupera una copia. Antes respalda la actual, así es reversible."""
        if not re.fullmatch(r"campaign-[0-9-]{15}\.json", nombre or ""):
            raise ValueError("nombre de copia inválido")
        f = self.dir(pid) / "backups" / nombre
        if not f.exists():
            raise FileNotFoundError(nombre)
        return self.save_campaign(pid, json.loads(f.read_text()))

    def load_campaign(self, pid: str) -> dict | None:
        p = self.campaign_path(pid)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text())
        except Exception:
            return None

    def delete(self, pid: str) -> None:
        """Borra el proyecto. Los ficheros de vídeo/log NO se tocan: son de la
        biblioteca y pueden estar en uso por otro proyecto."""
        import shutil
        d = self.dir(pid)
        if d.is_dir():
            shutil.rmtree(d)
