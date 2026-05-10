export function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function formatDelta(ms: number): string {
  if (!ms || ms === 0) return '±0.000';
  const sign = ms > 0 ? '+' : '';
  const seconds = (ms / 1000).toFixed(3);
  return `${sign}${seconds}`;
}

export function formatSpeed(kmh: number): string {
  return kmh?.toFixed(0) ?? '0';
}

export function formatGear(gear: number): string {
  if (gear === -1) return 'R';
  if (gear === 0) return 'N';
  return gear.toString();
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function formatTemp(celsius: number): string {
  return `${celsius.toFixed(0)}°C`;
}

export function formatPressure(bar: number): string {
  return `${bar.toFixed(1)}`;
}

export function formatFuel(kg: number): string {
  return `${kg.toFixed(1)}kg`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}
