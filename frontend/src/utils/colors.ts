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
