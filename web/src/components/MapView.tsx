import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStore } from '../store'
import { api } from '../api'
import { warpFrameToQuad } from '../warp'
import { frameIndex, type GcpPoint } from '../sampler/gcp'

// Dos capas base conmutables:
//  - PNOA (IGN): ortofoto oficial de España, 25cm, sin token -> para ver el terreno
//  - OSM: callejero, por si se quiere referencia de calles
// Ambas raster, sin API key.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    pnoa: {
      type: 'raster',
      // WMTS del IGN (PNOA máxima actualidad), proyección Web Mercator (GoogleMapsCompatible)
      tiles: [
        'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
      ],
      tileSize: 256,
      attribution: '© Instituto Geográfico Nacional (PNOA)',
    },
    osm: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    { id: 'pnoa', type: 'raster', source: 'pnoa' },
    // OSM oculto por defecto; se alterna con el botón
    { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
  ],
}

export function MapView() {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  // swapView=true => el mapa es la miniatura (PiP): ocultamos los carteles.
  const isMini = useStore((s) => s.swapView)
  const log = useStore((s) => s.log)
  const position = useStore((s) => s.position)
  const footprint = useStore((s) => s.footprint)
  const projectFrame = useStore((s) => s.projectFrame)
  const showOutline = useStore((s) => s.showOutline)
  const obliqueProject = useStore((s) => s.obliqueProject)
  const followDrone = useStore((s) => s.followDrone)
  const measureMode = useStore((s) => s.measureMode)
  const measureDecompose = useStore((s) => s.measureDecompose)
  const measurePoints = useStore((s) => s.measurePoints)
  const registerMap = useStore((s) => s.registerMap)
  const decompMarkersRef = useRef<maplibregl.Marker[]>([])
  const addMeasurePoint = useStore((s) => s.addMeasurePoint)
  const markedPoint = useStore((s) => s.markedPoint)
  const markMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [base, setBase] = useState<'pnoa' | 'osm'>('pnoa')
  const sourceId = useStore((s) => s.sourceId)
  const terrain = useStore((s) => s.terrain)
  const [showDem, setShowDem] = useState(false) // capa MDT visible (hillshade)
  const [demZ, setDemZ] = useState<number | null>(null) // altura bajo el cursor
  const gcpMode = useStore((s) => s.gcpMode)
  const gcpClickMap = useStore((s) => s.gcpClickMap)
  const gcpPendingPixel = useStore((s) => s.gcpPendingPixel)
  const gcpCampaign = useStore((s) => s.gcpCampaign)
  const gcpSelected = useStore((s) => s.gcpSelected)
  const currentTv = useStore((s) => s.currentTv)
  const video = useStore((s) => s.video)
  const gcpMarkersRef = useRef<maplibregl.Marker[]>([])

  const toggleBase = () => {
    const map = mapRef.current
    if (!map) return
    const next = base === 'pnoa' ? 'osm' : 'pnoa'
    map.setLayoutProperty('pnoa', 'visibility', next === 'pnoa' ? 'visible' : 'none')
    map.setLayoutProperty('osm', 'visibility', next === 'osm' ? 'visible' : 'none')
    setBase(next)
  }

  // ref con el modo medir actual, para el handler de click (registrado una vez)
  const measureModeRef = useRef(measureMode)
  measureModeRef.current = measureMode
  // idem para el modo GCP: el click sólo cuenta si hay un píxel esperando pareja
  const gcpRef = useRef({ mode: gcpMode, pending: gcpPendingPixel, click: gcpClickMap })
  gcpRef.current = { mode: gcpMode, pending: gcpPendingPixel, click: gcpClickMap }

  // init mapa
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [-0.745, 41.774],
      zoom: 14,
      // necesario para poder capturar el canvas con toDataURL (muestreo del paper)
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map
    registerMap(map)
    // click en el mapa: si estamos midiendo, añade un vértice; en modo GCP,
    // cierra el par foto->terreno que estaba pendiente.
    map.on('click', (e) => {
      const g = gcpRef.current
      if (g.mode) {
        if (g.pending) g.click(e.lngLat.lng, e.lngLat.lat)
        return
      }
      if (measureModeRef.current) {
        addMeasurePoint(e.lngLat.lng, e.lngLat.lat)
      }
    })
    return () => {
      registerMap(null)
      map.remove()
      mapRef.current = null
    }
  }, [addMeasurePoint, registerMap])

  // pintar trayectoria + ajustar vista al bbox
  useEffect(() => {
    const map = mapRef.current
    if (!map || !log) return
    const draw = () => {
      if (map.getSource('track')) {
        ;(map.getSource('track') as maplibregl.GeoJSONSource).setData(
          log.geojson as GeoJSON.Feature,
        )
      } else {
        map.addSource('track', { type: 'geojson', data: log.geojson as GeoJSON.Feature })
        map.addLayer({
          id: 'track-line',
          type: 'line',
          source: 'track',
          paint: { 'line-color': '#2563eb', 'line-width': 2.5 },
        })
      }
      const [minLat, minLng, maxLat, maxLng] = log.bbox
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 60, duration: 500 },
      )
    }
    if (map.isStyleLoaded()) draw()
    else map.once('load', draw)
  }, [log])

  // proyectar el frame del vídeo sobre el mapa (footprint)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const SRC = 'frame-proj'
    const removeImage = () => {
      if (map.getLayer(`${SRC}-layer`)) map.removeLayer(`${SRC}-layer`)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
    const removeOutline = () => {
      if (map.getLayer(`${SRC}-outline`)) map.removeLayer(`${SRC}-outline`)
      if (map.getSource(`${SRC}-line`)) map.removeSource(`${SRC}-line`)
    }

    const hasFp = !!footprint && footprint.valid && footprint.corners.length === 4
    if (!hasFp) {
      removeImage()
      removeOutline()
      return
    }
    // rectángulo nadir -> para la IMAGEN
    const rect = footprint!.corners as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
    // silueta real (trapecio si oblicuo) -> para el CONTORNO
    const outline = footprint!.outline_corners

    // --- CONTORNO: silueta real (trapezoidal). Independiente (check showOutline) ---
    removeOutline()
    if (showOutline && outline && outline.length === 4) {
      map.addSource(`${SRC}-line`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [outline[0], outline[1], outline[2], outline[3], outline[0]],
          },
          properties: {},
        },
      })
      map.addLayer({
        id: `${SRC}-outline`,
        type: 'line',
        source: `${SRC}-line`,
        // contorno del footprint: siempre naranja y línea continua
        paint: {
          'line-color': '#f59e0b',
          'line-width': 3,
          'line-dasharray': [1],
        },
      })
    }

    // --- IMAGEN ---
    // Modo experimental (obliqueProject): el frame se deforma con homografía a
    // la SILUETA real (trapecio) — funciona también en oblicuo/curvas. No se
    // proyecta si el horizonte entra en el encuadre (clipped: geometría al
    // infinito, imposible de mapear al suelo).
    // Modo normal (projectFrame): rectángulo cenital, solo si nadir_ok.
    removeImage()
    const video = document.querySelector('video') as HTMLVideoElement | null
    if (video && video.readyState >= 2) {
      if (obliqueProject && !footprint!.clipped && outline && outline.length === 4) {
        const res = warpFrameToQuad(video, outline)
        if (res) {
          map.addSource(SRC, { type: 'image', url: res.url, coordinates: res.coords })
          map.addLayer({
            id: `${SRC}-layer`,
            type: 'raster',
            source: SRC,
            paint: { 'raster-opacity': 0.8 },
          })
        }
      } else if (!obliqueProject && projectFrame && footprint!.nadir_ok) {
        const cv = document.createElement('canvas')
        cv.width = video.videoWidth
        cv.height = video.videoHeight
        const ctx = cv.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0)
          const url = cv.toDataURL('image/jpeg', 0.85)
          map.addSource(SRC, { type: 'image', url, coordinates: rect })
          map.addLayer({
            id: `${SRC}-layer`,
            type: 'raster',
            source: SRC,
            paint: { 'raster-opacity': 0.75 },
          })
        }
      }
    }
  }, [footprint, projectFrame, showOutline, obliqueProject])

  // mover el marcador de posición del dron (el corazón del ajustador)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    if (!markerRef.current) {
      const el = document.createElement('div')
      el.style.cssText =
        'width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;' +
        'border-bottom:16px solid #ef4444;transform-origin:center;filter:drop-shadow(0 0 2px #000)'
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([position.lng, position.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([position.lng, position.lat])
    }
    // orientar la flecha según el yaw
    const el = markerRef.current.getElement()
    el.style.transform = `${el.style.transform.replace(/rotate\([^)]*\)/, '')} rotate(${position.yaw}deg)`

    // seguir al dron: centrar el mapa en su posición
    if (followDrone) {
      map.easeTo({ center: [position.lng, position.lat], duration: 200 })
    }
  }, [position, followDrone])

  // marcador del punto marcado en la foto (con sus coordenadas)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!markedPoint) {
      markMarkerRef.current?.remove()
      markMarkerRef.current = null
      return
    }
    const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
      `<div style="font:12px monospace">${markedPoint.lat.toFixed(6)}, ${markedPoint.lng.toFixed(6)}</div>`,
    )
    if (!markMarkerRef.current) {
      markMarkerRef.current = new maplibregl.Marker({ color: '#2563eb' })
        .setLngLat([markedPoint.lng, markedPoint.lat])
        .setPopup(popup)
        .addTo(map)
      markMarkerRef.current.togglePopup()
    } else {
      markMarkerRef.current.setLngLat([markedPoint.lng, markedPoint.lat]).setPopup(popup)
      if (!markMarkerRef.current.getPopup()?.isOpen()) markMarkerRef.current.togglePopup()
    }
  }, [markedPoint])

  // capa MDT visible: el mismo ráster que gobierna el AGL, coloreado (hillshade
  // + rampa de altura). Se pinta como image source sobre sus bounds.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const SRC = 'dem-layer'
    const remove = () => {
      if (map.getLayer(`${SRC}-l`)) map.removeLayer(`${SRC}-l`)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
    if (!showDem || !sourceId || terrain === 'flat') {
      remove()
      return
    }
    let cancelled = false
    api
      .terrainMeta(sourceId, terrain)
      .then((meta) => {
        if (cancelled || !meta.available || !meta.bounds) return
        remove()
        // MapLibre pide las 4 esquinas TL,TR,BR,BL como [lng,lat]
        const b = meta.bounds
        const coords: [[number, number], [number, number], [number, number], [number, number]] = [
          [b[0][0], b[0][1]],
          [b[1][0], b[1][1]],
          [b[2][0], b[2][1]],
          [b[3][0], b[3][1]],
        ]
        map.addSource(SRC, {
          type: 'image',
          url: api.terrainImageUrl(sourceId, terrain),
          coordinates: coords,
        })
        map.addLayer({ id: `${SRC}-l`, type: 'raster', source: SRC, paint: { 'raster-opacity': 0.85 } })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [showDem, sourceId, terrain])

  // altura del terreno bajo el cursor (solo con la capa MDT activa)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!showDem || !sourceId || terrain === 'flat') {
      setDemZ(null)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastToken = 0
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (timer) clearTimeout(timer)
      const { lng, lat } = e.lngLat
      timer = setTimeout(async () => {
        const token = ++lastToken
        try {
          const r = await api.terrainElevation(sourceId, lat, lng, terrain)
          if (token === lastToken) setDemZ(r.z)
        } catch {
          /* ignore */
        }
      }, 60) // debounce: no una petición por píxel
    }
    const onLeave = () => setDemZ(null)
    map.on('mousemove', onMove)
    map.on('mouseout', onLeave)
    return () => {
      map.off('mousemove', onMove)
      map.off('mouseout', onLeave)
      if (timer) clearTimeout(timer)
    }
  }, [showDem, sourceId, terrain])

  // cursor cruz cuando medimos o cuando hay un píxel esperando su pareja
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = measureMode || (gcpMode && gcpPendingPixel) ? 'crosshair' : ''
  }, [measureMode, gcpMode, gcpPendingPixel])

  // --- puntos de control: verdad-terreno vs las dos proyecciones ---
  // Por cada punto: el punto real (verde), la proyección ortogonal (azul) y la
  // proyección con actitud (rojo), cada una unida a su verdad-terreno por los
  // catetos X/Y en discontinua. Esta es la figura del paper.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const IDS = ['gcp-legs-ortho', 'gcp-legs-att', 'gcp-truth', 'gcp-ortho', 'gcp-att']
    const clean = () => {
      for (const id of IDS) {
        if (map.getLayer(`${id}-l`)) map.removeLayer(`${id}-l`)
        if (map.getSource(id)) map.removeSource(id)
      }
      gcpMarkersRef.current.forEach((m) => m.remove())
      gcpMarkersRef.current = []
    }
    clean()
    if (!gcpMode) return

    // sólo el fotograma actual: mezclar frames en el mapa sería ilegible
    const frame = video
      ? gcpCampaign.frames.find(
          (f) => f.telemetry.frame_index === frameIndex(currentTv, video.fps),
        )
      : undefined
    if (!frame || frame.points.length === 0) return

    const ORTHO = '#2563eb'
    const ATT = '#dc2626'
    const TRUTH = '#22c55e'

    // catetos X/Y de proyección -> verdad-terreno, en discontinua
    const legsFor = (which: 'ortho' | 'attitude') => {
      const feats: GeoJSON.Feature[] = []
      for (const p of frame.points) {
        const proj = which === 'ortho' ? p.ortho : p.attitude
        if (!proj) continue
        const corner: [number, number] = [p.truth.lng, proj.lat]
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[proj.lng, proj.lat], corner] },
        })
        feats.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [corner, [p.truth.lng, p.truth.lat]] },
        })
      }
      return { type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection
    }

    const addLegs = (id: string, which: 'ortho' | 'attitude', color: string) => {
      map.addSource(id, { type: 'geojson', data: legsFor(which) })
      map.addLayer({
        id: `${id}-l`,
        type: 'line',
        source: id,
        paint: { 'line-color': color, 'line-width': 1.8, 'line-dasharray': [2, 1.5] },
      })
    }
    addLegs('gcp-legs-ortho', 'ortho', ORTHO)
    addLegs('gcp-legs-att', 'attitude', ATT)

    const addPts = (id: string, pick: (p: GcpPoint) => { lng: number; lat: number } | null, color: string) => {
      const feats = frame.points
        .map((p) => {
          const c = pick(p)
          return c
            ? ({
                type: 'Feature',
                properties: { id: p.id },
                geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
              } as GeoJSON.Feature)
            : null
        })
        .filter(Boolean) as GeoJSON.Feature[]
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: feats } })
      map.addLayer({
        id: `${id}-l`,
        type: 'circle',
        source: id,
        paint: {
          'circle-radius': 5,
          'circle-color': color,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      })
    }
    addPts('gcp-ortho', (p) => p.ortho, ORTHO)
    addPts('gcp-att', (p) => p.attitude, ATT)
    addPts('gcp-truth', (p) => p.truth, TRUTH)

    // etiqueta con el identificador y el error de cada proyección
    const fmt = (m: number) => `${m.toFixed(1)}m`
    for (const p of frame.points) {
      const on = gcpSelected?.frameId === frame.frame_id && gcpSelected?.pointId === p.id
      const el = document.createElement('div')
      el.innerHTML =
        `<b>${p.id}</b>` +
        (p.err_ortho ? ` <span style="color:#93c5fd">${fmt(p.err_ortho.direct)}</span>` : '') +
        (p.err_attitude ? ` <span style="color:#fca5a5">${fmt(p.err_attitude.direct)}</span>` : '')
      el.style.cssText =
        `background:${on ? '#facc15' : 'rgba(17,24,39,.85)'};color:${on ? '#000' : '#fff'};` +
        'font:600 11px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:3px;' +
        'white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.5);transform:translateY(-14px)'
      gcpMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([p.truth.lng, p.truth.lat]).addTo(map),
      )
    }
  }, [gcpMode, gcpCampaign, currentTv, gcpSelected, video])

  // dibujar la línea de medición: vértices + segmentos + distancia total
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const LINE = 'measure-line'
    const PTS = 'measure-pts'
    const LEGS = 'measure-legs'
    const clean = () => {
      if (map.getLayer(`${LINE}-l`)) map.removeLayer(`${LINE}-l`)
      if (map.getLayer(`${PTS}-l`)) map.removeLayer(`${PTS}-l`)
      if (map.getLayer(`${LEGS}-l`)) map.removeLayer(`${LEGS}-l`)
      if (map.getSource(LINE)) map.removeSource(LINE)
      if (map.getSource(PTS)) map.removeSource(PTS)
      if (map.getSource(LEGS)) map.removeSource(LEGS)
      decompMarkersRef.current.forEach((m) => m.remove())
      decompMarkersRef.current = []
    }
    clean()
    if (measurePoints.length === 0) return

    // Haversine entre dos puntos [lng,lat] -> metros
    const R = 6371000
    const toRad = (d: number) => (d * Math.PI) / 180
    const haversine = (lo1: number, la1: number, lo2: number, la2: number) => {
      const dLat = toRad(la2 - la1)
      const dLng = toRad(lo2 - lo1)
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2
      return 2 * R * Math.asin(Math.sqrt(a))
    }

    if (measurePoints.length >= 2) {
      map.addSource(LINE, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: measurePoints }, properties: {} },
      })
      map.addLayer({
        id: `${LINE}-l`,
        type: 'line',
        source: LINE,
        paint: { 'line-color': '#dc2626', 'line-width': 2.5, 'line-dasharray': [2, 1] },
      })
    }
    // vértices
    map.addSource(PTS, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: measurePoints.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: c },
          properties: {},
        })),
      },
    })
    map.addLayer({
      id: `${PTS}-l`,
      type: 'circle',
      source: PTS,
      paint: { 'circle-radius': 4, 'circle-color': '#dc2626', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    })

    // Descomposición del ÚLTIMO tramo en catetos X (E-O) e Y (N-S).
    // El vértice esquina se coloca en (lng del punto final, lat del punto inicial):
    // el cateto X va de A al esquina (horizontal) y el Y del esquina a B (vertical).
    if (measureDecompose && measurePoints.length >= 2) {
      const [loA, laA] = measurePoints[measurePoints.length - 2]
      const [loB, laB] = measurePoints[measurePoints.length - 1]
      const corner: [number, number] = [loB, laA]
      const dx = haversine(loA, laA, loB, laA) // este-oeste
      const dy = haversine(loB, laA, loB, laB) // norte-sur

      map.addSource(LEGS, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[loA, laA], corner] } },
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [corner, [loB, laB]] } },
          ],
        },
      })
      map.addLayer({
        id: `${LEGS}-l`,
        type: 'line',
        source: LEGS,
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      })

      // etiquetas X=… / Y=… en el punto medio de cada cateto
      const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)
      const label = (text: string, at: [number, number]) => {
        const el = document.createElement('div')
        el.textContent = text
        el.style.cssText =
          'background:#2563eb;color:#fff;font:600 11px/1.2 system-ui,sans-serif;' +
          'padding:1px 5px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.4)'
        const mk = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map)
        decompMarkersRef.current.push(mk)
      }
      label(`X=${fmt(dx)}`, [(loA + loB) / 2, laA])
      label(`Y=${fmt(dy)}`, [loB, (laA + laB) / 2])
    }
  }, [measurePoints, measureDecompose])

  return (
    // en miniatura (PiP) añadimos 'map-mini' para ocultar la atribución vía CSS
    <div className={`relative w-full h-full ${isMini ? 'map-mini' : ''}`}>
      <div ref={containerRef} className="w-full h-full" />
      {!isMini && (
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          {terrain !== 'flat' && (
            <button
              onClick={() => setShowDem((v) => !v)}
              className={`border rounded px-3 py-1 text-xs font-semibold shadow ${
                showDem
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white/90 border-gray-300 hover:bg-white'
              }`}
              title="Mostrar/ocultar el modelo del terreno (MDT) coloreado"
            >
              ⛰ MDT {terrain === 'ign' ? '(IGN)' : '(Cop)'}
            </button>
          )}
          <button
            onClick={toggleBase}
            className="bg-white/90 border border-gray-300 rounded px-3 py-1 text-xs font-semibold shadow hover:bg-white"
            title="Alternar entre ortofoto (PNOA) y callejero (OSM)"
          >
            {base === 'pnoa' ? '🛰 Satellite (PNOA)' : '🗺 Street map (OSM)'}
          </button>
        </div>
      )}

      {/* altura del terreno bajo el cursor (solo con la capa MDT activa) */}
      {!isMini && showDem && terrain !== 'flat' && (
        <div className="absolute bottom-2 left-2 z-10 bg-black/75 text-white rounded px-3 py-1.5 text-xs font-mono shadow">
          {demZ != null ? `${demZ.toFixed(1)} m` : 'terreno: —'}
        </div>
      )}
    </div>
  )
}
