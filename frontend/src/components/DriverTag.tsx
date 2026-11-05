import { driverCode, teamColor } from '@/utils/teams';

// A driver as the timing screen shows them: three letters on the team colour.
export default function DriverTag({ name, teamId, size = 'md' }: { name: string; teamId?: number; size?: 'sm' | 'md' }) {
  const color = teamColor(teamId);
  const cls = size === 'sm'
    ? 'px-1.5 h-5 text-[11px]'
    : 'px-2 h-6 text-[13px]';
  return (
    <span
      className={`inline-flex items-center font-telemetry font-bold tracking-wider leading-none text-black ${cls}`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {driverCode(name)}
    </span>
  );
}
