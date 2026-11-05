// F1 23/24 team ids as the game reports them.
export const TEAM_COLORS: Record<number, string> = {
  0:  '#00D2BE',  // Mercedes
  1:  '#E8002D',  // Ferrari
  2:  '#3671C6',  // Red Bull
  3:  '#64C4FF',  // Williams
  4:  '#358C75',  // Aston Martin
  5:  '#0090FF',  // Alpine
  6:  '#5E8FAA',  // AlphaTauri / RB
  7:  '#B6BABD',  // Haas
  8:  '#FF8000',  // McLaren
  9:  '#C92D4B',  // Alfa Romeo / Sauber
  85: '#AAAAAA',  // MyTeam
};

export const TEAM_NAMES: Record<number, string> = {
  0: 'Mercedes', 1: 'Ferrari', 2: 'Red Bull', 3: 'Williams', 4: 'Aston Martin',
  5: 'Alpine', 6: 'AlphaTauri', 7: 'Haas', 8: 'McLaren', 9: 'Alfa Romeo', 85: 'MyTeam',
};

const FALLBACK_COLOR = '#888888';

export function teamColor(teamId: number | undefined): string {
  if (teamId === undefined) return FALLBACK_COLOR;
  return TEAM_COLORS[teamId] ?? FALLBACK_COLOR;
}

// Three-letter code the way timing screens write it: HAM, LEC, PÉR → PER.
export function driverCode(name: string): string {
  const last = name.trim().split(/\s+/).pop() ?? name;
  return last.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().slice(0, 3);
}
