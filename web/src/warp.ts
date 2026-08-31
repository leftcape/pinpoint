// Proyección (experimental) del frame sobre la SILUETA real del footprint.
//
// MapLibre renderiza las image sources interpolando el cuadrilátero como dos
// triángulos: en un trapecio pronunciado la textura se quiebra por la diagonal.
// Para evitarlo, pre-deformamos el frame con una HOMOGRAFÍA real (malla de
// celdas afines sobre un canvas, error subpíxel con N>=10) y publicamos el
// canvas en un bbox alineado a ejes con alfa fuera del cuadrilátero.

export interface WarpResult {
  url: string
  // esquinas del bbox [lng,lat] en orden TL,TR,BR,BL para el image source
  coords: [[number, number], [number, number], [number, number], [number, number]]
}

// Resuelve A·x = b por eliminación gaussiana con pivote parcial.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  // tras la eliminación Jordan, M es diagonal: x[i] = M[i][n] / M[i][i]
  return M.map((row, i) => row[n] / row[i])
}

// Homografía 3x3 (fila-mayor, h33=1) que lleva src[i] -> dst[i] (4 pares).
function homography(src: [number, number][], dst: [number, number][]): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [X, Y] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    b.push(Y)
  }
  const h = solve(A, b)
  return h ? [...h, 1] : null
}

function apply(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

/**
 * Deforma el frame actual del vídeo al cuadrilátero geográfico `quad`
 * ([lng,lat] en orden TL,TR,BR,BL de la imagen) y devuelve un PNG (con alfa)
 * más las esquinas del bbox para MapLibre. A esta escala (cientos de metros),
 * tratar lat/lng como plano local es válido (error << 1 px).
 */
export function warpFrameToQuad(
  video: HTMLVideoElement,
  quad: [number, number][],
): WarpResult | null {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h || quad.length !== 4) return null

  const lngs = quad.map((q) => q[0])
  const lats = quad.map((q) => q[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  if (maxLng - minLng < 1e-9 || maxLat - minLat < 1e-9) return null

  // tamaño del canvas proporcional al bbox en metros (limitado a 1024 px)
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const wMeters = (maxLng - minLng) * 111320 * cosLat
  const hMeters = (maxLat - minLat) * 111320
  const scale = 1024 / Math.max(wMeters, hMeters)
  const W = Math.max(64, Math.round(wMeters * scale))
  const H = Math.max(64, Math.round(hMeters * scale))

  const toPx = (lng: number, lat: number): [number, number] => [
    ((lng - minLng) / (maxLng - minLng)) * W,
    ((maxLat - lat) / (maxLat - minLat)) * H,
  ]
  const dst = quad.map((q) => toPx(q[0], q[1])) as [number, number][]
  const Hm = homography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    dst,
  )
  if (!Hm) return null

  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')
  if (!ctx) return null

  // malla NxN: cada celda del frame se dibuja con una afín ajustada a sus
  // esquinas destino, recortada al cuadrilátero de la celda
  const N = 14
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x0 = (i / N) * w
      const x1 = ((i + 1) / N) * w
      const y0 = (j / N) * h
      const y1 = ((j + 1) / N) * h
      const p00 = apply(Hm, x0, y0)
      const p10 = apply(Hm, x1, y0)
      const p11 = apply(Hm, x1, y1)
      const p01 = apply(Hm, x0, y1)
      // afín que lleva (x0,y0),(x1,y0),(x0,y1) -> p00,p10,p01
      const a = (p10[0] - p00[0]) / (x1 - x0)
      const bx = (p01[0] - p00[0]) / (y1 - y0)
      const c = (p10[1] - p00[1]) / (x1 - x0)
      const d = (p01[1] - p00[1]) / (y1 - y0)
      const e = p00[0] - a * x0 - bx * y0
      const f = p00[1] - c * x0 - d * y0
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(p00[0], p00[1])
      ctx.lineTo(p10[0], p10[1])
      ctx.lineTo(p11[0], p11[1])
      ctx.lineTo(p01[0], p01[1])
      ctx.closePath()
      ctx.clip()
      ctx.setTransform(a, c, bx, d, e, f)
      ctx.drawImage(video, 0, 0)
      ctx.restore()
    }
  }

  return {
    url: cv.toDataURL('image/png'), // png: conserva el alfa fuera del cuadrilátero
    coords: [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ],
  }
}

/**
 * Píxel de la foto que corresponde a un punto del suelo, usando la MISMA
 * homografía con la que se proyecta el frame sobre su huella. Es la inversa de
 * `warpFrameToQuad`: sirve para que un click en el mapa caiga donde toca en la
 * imagen.
 *
 * `quad` son las esquinas [lng,lat] de la huella en orden TL,TR,BR,BL. Devuelve
 * null si la homografía es degenerada o si el punto cae FUERA de la foto: un
 * píxel fuera del encuadre no es una medida, es una extrapolación.
 */
export function groundToPixel(
  quad: [number, number][],
  imgW: number,
  imgH: number,
  lng: number,
  lat: number,
): { px: number; py: number } | null {
  if (quad.length !== 4 || !imgW || !imgH) return null
  // homografía en el sentido contrario: suelo -> píxel de la imagen
  const Hinv = homography(quad as [number, number][], [
    [0, 0],
    [imgW, 0],
    [imgW, imgH],
    [0, imgH],
  ])
  if (!Hinv) return null
  const [px, py] = apply(Hinv, lng, lat)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  // Holgura de medio píxel: en el borde exacto de la huella la homografía
  // devuelve -1e-6 en vez de 0, y rechazar por eso sería un fallo fantasma.
  // Se recorta al rango válido para no emitir nunca un píxel fuera de la imagen.
  const tol = 0.5
  if (px < -tol || py < -tol || px > imgW + tol || py > imgH + tol) return null
  return {
    px: Math.min(imgW, Math.max(0, px)),
    py: Math.min(imgH, Math.max(0, py)),
  }
}
