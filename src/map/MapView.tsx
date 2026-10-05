import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'preact/hooks';
import type { Pin } from '../domain/pins.ts';
import type { Campaign, LatLng, ReferenceFeature } from '../domain/types.ts';
import {
  meFeatures,
  ME,
  pinFeatures,
  PINS,
  REFERENCE,
  referenceFeatures,
  TERRAIN_LAYERS,
  TETHER,
  tetherFeatures,
} from './layers.ts';
import { loadMapLibre } from './maplibre.ts';
import { mapStyle } from './style.ts';

/** A request to move the camera; a new id moves it again to the same place. */
export interface Focus {
  id: number;
  position: LatLng;
  zoom: number;
}

export interface MapViewProps {
  basemapUrl: string | null;
  bounds: Campaign['bounds'];
  pins: readonly Pin[];
  /** The file's lines, shapes and routes, drawn muted under the pins. */
  reference: readonly ReferenceFeature[];
  selectedPinId: string | null;
  linkedPinIds: ReadonlySet<string>;
  tetherFrom: LatLng | null;
  tetherTo: readonly LatLng[];
  me: { position: LatLng; accuracyM: number } | null;
  focus: Focus | null;
  onTapPin: (pin: Pin) => void;
  onTapMap: () => void;
  label: string;
}

/** Half the 56 px touch target (§9): a tap this close to a pin opens it. */
const HIT = 28;
// Rural Québec, when no row has a position yet.
const QUEBEC: [number, number] = [-73.6, 45.6];

declare global {
  interface Window {
    /** The map, for the end-to-end tests to find pins on screen. */
    terrainMap?: MapLibreMap;
  }
}

type Overlay = Pick<
  MapViewProps,
  'pins' | 'reference' | 'selectedPinId' | 'linkedPinIds' | 'tetherFrom' | 'tetherTo' | 'me'
>;

function draw(map: MapLibreMap, overlay: Overlay): void {
  void map.getSource<GeoJSONSource>(REFERENCE)?.setData(referenceFeatures(overlay.reference));
  void map
    .getSource<GeoJSONSource>(PINS)
    ?.setData(pinFeatures(overlay.pins, overlay.selectedPinId, overlay.linkedPinIds));
  void map
    .getSource<GeoJSONSource>(TETHER)
    ?.setData(tetherFeatures(overlay.tetherFrom, overlay.tetherTo));
  void map.getSource<GeoJSONSource>(ME)?.setData(meFeatures(overlay.me));
}

/** The full-screen map (§5.2): the offline basemap, one pin per house, the lot tether, the GPS dot. */
export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const {
    basemapUrl,
    pins,
    reference,
    selectedPinId,
    linkedPinIds,
    tetherFrom,
    tetherTo,
    me,
    focus,
  } = props;

  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | null = null;
    void loadMapLibre().then((maplibre) => {
      if (cancelled || !container.current) return;
      const { bounds } = latest.current;
      created = new maplibre.Map({
        container: container.current,
        style: mapStyle(basemapUrl, window.location.origin),
        ...(bounds
          ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 15 } }
          : { center: QUEBEC, zoom: 7 }),
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
      });
      created.touchZoomRotate.disableRotation();
      created.keyboard.disableRotation();
      const instance = created;
      instance.on('load', () => {
        instance.addSource(REFERENCE, { type: 'geojson', data: referenceFeatures([]) });
        instance.addSource(PINS, { type: 'geojson', data: pinFeatures([], null, new Set()) });
        instance.addSource(TETHER, { type: 'geojson', data: tetherFeatures(null, []) });
        instance.addSource(ME, { type: 'geojson', data: meFeatures(null) });
        for (const layer of TERRAIN_LAYERS) instance.addLayer(layer);
        loaded.current = true;
        draw(instance, latest.current);
      });
      instance.on('click', (event) => {
        const { x, y } = event.point;
        const hits = instance.queryRenderedFeatures(
          [
            [x - HIT, y - HIT],
            [x + HIT, y + HIT],
          ],
          { layers: [PINS] },
        );
        let nearest: { id: string; distance: number } | null = null;
        for (const hit of hits) {
          if (hit.geometry.type !== 'Point') continue;
          const [lng = 0, lat = 0] = hit.geometry.coordinates;
          const at = instance.project([lng, lat]);
          const distance = Math.hypot(at.x - x, at.y - y);
          const id = (hit.properties as { id?: string }).id;
          if (id !== undefined && (!nearest || distance < nearest.distance))
            nearest = { id, distance };
        }
        const pin = nearest && latest.current.pins.find((candidate) => candidate.id === nearest.id);
        if (pin) latest.current.onTapPin(pin);
        else latest.current.onTapMap();
      });
      map.current = instance;
      window.terrainMap = instance;
    });
    return () => {
      cancelled = true;
      loaded.current = false;
      created?.remove();
      map.current = null;
    };
  }, [basemapUrl]);

  useEffect(() => {
    if (map.current && loaded.current)
      draw(map.current, { pins, reference, selectedPinId, linkedPinIds, tetherFrom, tetherTo, me });
  }, [pins, reference, selectedPinId, linkedPinIds, tetherFrom, tetherTo, me]);

  useEffect(() => {
    if (!focus || !map.current) return;
    map.current.easeTo({
      center: [focus.position.lng, focus.position.lat],
      zoom: Math.max(map.current.getZoom(), focus.zoom),
      padding: { top: 0, right: 0, left: 0, bottom: underCard(map.current) },
      duration: motion(),
    });
  }, [focus]);

  // A selected pin under the card slides up into the map that shows above it.
  useEffect(() => {
    const instance = map.current;
    const pin = latest.current.pins.find((candidate) => candidate.id === selectedPinId);
    if (!instance || !pin) return;
    const at = instance.project([pin.position.lng, pin.position.lat]);
    if (at.y < instance.getContainer().clientHeight - underCard(instance) - 24) return;
    instance.easeTo({
      center: [pin.position.lng, pin.position.lat],
      padding: { top: 0, right: 0, left: 0, bottom: underCard(instance) },
      duration: motion(),
    });
  }, [selectedPinId]);

  return <div ref={container} class="map" role="application" aria-label={props.label} />;
}

/** The height the house card covers (up to 62 % of the screen, styles.css). */
function underCard(map: MapLibreMap): number {
  return Math.round(map.getContainer().clientHeight * 0.62);
}

function motion(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
}
