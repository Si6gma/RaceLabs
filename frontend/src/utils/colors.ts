export const TELEMETRY_COLORS = {
  speed: '#00e5ff',
  throttle: '#00e676',
  brake: '#ff1744',
  rpm: '#d500f9',
  steering: '#ffea00',
  gForce: '#ff6b00',
  gear: '#ffffff',
  drs: '#00e5ff',
  ers: '#7c4dff',
  fuel: '#ff9100',
  tyreTemp: '#ff1744',
  tyreWear: '#ff6b00',
  brakeTemp: '#ff1744',
  engineTemp: '#ff9100',
};

export const TYRE_COLORS = {
  fl: '#ff1744',
  fr: '#ff1744',
  rl: '#ff1744',
  rr: '#ff1744',
};

export const COMPOUND_COLORS: Record<number, string> = {
  16: '#ff1744', // C5 - Soft
  17: '#ff1744',
  18: '#ff9100', // C3 - Medium
  19: '#ffea00', // C1 - Hard
  20: '#ffffff', // Inters
  21: '#00e5ff', // Wet
};

export function getDeltaColor(deltaMs: number): string {
  if (deltaMs < -50) return '#00e676';
  if (deltaMs < 0) return '#69f0ae';
  if (deltaMs === 0) return '#ffffff';
  if (deltaMs < 50) return '#ff9100';
  return '#ff1744';
}

export function getTempColor(temp: number): string {
  if (temp < 60) return '#00e5ff';
  if (temp < 80) return '#00e676';
  if (temp < 95) return '#ffea00';
  if (temp < 110) return '#ff9100';
  return '#ff1744';
}

export function getWearColor(wear: number): string {
  if (wear < 10) return '#00e676';
  if (wear < 30) return '#ffea00';
  if (wear < 50) return '#ff9100';
  if (wear < 70) return '#ff6b00';
  return '#ff1744';
}

/** Green → Yellow → Red heat map. t is 0..1 where 0=safe, 1=danger. */
function heatGradient(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    // green (#00e676) → yellow (#ffea00)
    const p = clamped * 2;
    const r = Math.round(0 + (255 - 0) * p);
    const g = Math.round(230 + (234 - 230) * p);
    const b = Math.round(118 + (0 - 118) * p);
    return `rgb(${r},${g},${b})`;
  }
  // yellow (#ffea00) → red (#ff1744)
  const p = (clamped - 0.5) * 2;
  const r = Math.round(255 + (255 - 255) * p);
  const g = Math.round(234 + (23 - 234) * p);
  const b = Math.round(0 + (68 - 0) * p);
  return `rgb(${r},${g},${b})`;
}

/**
 * Returns a heat-map colour for telemetry gauges.
 * @param value    current reading
 * @param safe     threshold where things are green
 * @param danger   threshold where things are red
 * @param mode     'ascending' = high values are bad (temp, g-force)
 *                 'descending' = low values are bad (fuel, laps)
 */
export function getHeatColor(
  value: number,
  safe: number,
  danger: number,
  mode: 'ascending' | 'descending' = 'ascending'
): string {
  if (mode === 'ascending') {
    if (value <= safe) return '#00e676';
    if (value >= danger) return '#ff1744';
    return heatGradient((value - safe) / (danger - safe));
  }
  // descending: low is bad
  if (value >= safe) return '#00e676';
  if (value <= danger) return '#ff1744';
  return heatGradient((safe - value) / (safe - danger));
}
