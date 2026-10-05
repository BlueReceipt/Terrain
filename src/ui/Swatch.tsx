export function Swatch({ color }: { color: string }) {
  return <span class="swatch" style={{ backgroundColor: color }} aria-hidden="true" />;
}
