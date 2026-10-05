import { signal } from '@preact/signals';
import type { LatLng } from '../domain/types.ts';

export interface Fix {
  position: LatLng;
  /** Meters, at 68 % confidence (the browser's accuracy). */
  accuracyM: number;
  at: number;
}

export type LocationState = 'off' | 'waiting' | 'on' | 'denied' | 'unavailable';

/** The phone's position while the map is on screen. Works without data. */
export const myFix = signal<Fix | null>(null);
export const locationState = signal<LocationState>('off');

let watchId: number | null = null;

export function startLocating(): void {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) {
    locationState.value = 'unavailable';
    return;
  }
  if (locationState.value !== 'on') locationState.value = 'waiting';
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      myFix.value = {
        position: { lat: position.coords.latitude, lng: position.coords.longitude },
        accuracyM: position.coords.accuracy,
        at: position.timestamp,
      };
      locationState.value = 'on';
    },
    (error) => {
      locationState.value = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
  );
}

export function stopLocating(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (locationState.value === 'waiting') locationState.value = 'off';
}
