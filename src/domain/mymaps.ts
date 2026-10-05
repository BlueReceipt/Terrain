/** A My Maps map ID: letters, digits, - and _ (Google's IDs run about 33 characters). */
const MAP_ID = /^[\w-]{10,128}$/;

/** A Google Maps "/maps/d/" address (My Maps), on any of Google's country domains. */
const MY_MAPS_URL = /https?:\/\/(?:www\.)?google\.[a-z.]{2,7}\/maps\/d\/[^\s"'<>]*/i;

/**
 * The ID of the My Maps map in what the user pasted: the map's link (viewer, edit, embed or kml),
 * the "Embed on my site" code, or the link inside a network-link KML. Null when there is none.
 */
export function myMapsId(text: string): string | null {
  const address = MY_MAPS_URL.exec(text)?.[0];
  if (!address) return null;
  let id: string | null;
  try {
    id = new URL(address.replace(/&amp;/g, '&')).searchParams.get('mid');
  } catch {
    return null;
  }
  return id && MAP_ID.test(id) ? id : null;
}
