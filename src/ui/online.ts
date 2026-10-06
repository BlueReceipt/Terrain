/**
 * Terrain's addresses with a relay (relay/worker.js, README "The relay"). There, and only there,
 * the map draws streets from the internet while online, and houses without coordinates are found
 * from their address (Alex, 2026-10-05): what goes online is the map area on screen and each
 * house's street, town, postal code and province, nothing else. Each is a switch in Settings.
 * Everywhere else Terrain never goes online.
 */
const RELAY_HOSTS: readonly string[] = ['terrain.ederer.digital', 'landagentfriend.ederer.digital'];

export function hasRelay(hostname: string): boolean {
  return RELAY_HOSTS.includes(hostname);
}
