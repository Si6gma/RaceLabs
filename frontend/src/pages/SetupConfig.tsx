import { useEffect, useMemo, useState } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { apiFetch, getControlKey, setControlKey } from '@/utils/api';
import trackOutlines from '@/data/track_outlines.json';

const TRACKS = Object.entries(trackOutlines as Record<string, { name: string }>)
  .map(([id, t]) => ({ id, name: t.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Settings that live on this browser or on the server. Nothing here is decoration:
// the control key decides who may press buttons, nicknames rename circuits everywhere.
export default function SetupConfig() {
  const trackAliases = useTelemetryStore(s => s.trackAliases);
  const setTrackAliases = useTelemetryStore(s => s.setTrackAliases);
  const session = useTelemetryStore(s => s.session);

  const [protectedServer, setProtectedServer] = useState<boolean | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [key, setKey] = useState(getControlKey());
  const [keyState, setKeyState] = useState<'unknown' | 'ok' | 'rejected'>('unknown');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/access').then(r => r.json()).then(d => setProtectedServer(!!d.protected)).catch(() => setProtectedServer(null));
    fetch('/health').then(r => setBackendUp(r.ok)).catch(() => setBackendUp(false));
    fetch('/api/tracks/aliases').then(r => r.json()).then(d => setTrackAliases(d.aliases ?? {})).catch(() => {});
  }, [setTrackAliases]);

  // Prove the key with a harmless write: re-saving a nickname to its current value.
  const saveKey = async () => {
    setControlKey(key.trim());
    if (!key.trim()) { setKeyState('unknown'); return; }
    const probe = TRACKS[0];
    const res = await apiFetch(`/api/tracks/${probe.id}/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: trackAliases[probe.id] ?? '' }),
    }).catch(() => null);
    setKeyState(res?.ok ? 'ok' : 'rejected');
  };

  const saveAlias = async (id: string) => {
    const nickname = (drafts[id] ?? trackAliases[id] ?? '').trim();
    if (nickname === (trackAliases[id] ?? '')) return;
    const res = await apiFetch(`/api/tracks/${id}/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setTrackAliases(data.aliases ?? {});
      setSavedId(id);
      setTimeout(() => setSavedId(s => (s === id ? null : s)), 1500);
    } else if (res?.status === 403) {
      setKeyState('rejected');
    }
  };

  const currentTrackId = session?.track_id != null ? String(session.track_id) : null;
  const orderedTracks = useMemo(
    () => [...TRACKS].sort((a, b) => (a.id === currentTrackId ? -1 : b.id === currentTrackId ? 1 : 0)),
    [currentTrackId],
  );

  const writesBlocked = protectedServer === true && (!getControlKey() || keyState === 'rejected');

  return (
    <div className="h-full flex gap-px p-px overflow-hidden bg-motorsport-border">
      {/* ── Left: who may press the buttons, and whether the backend is there ── */}
      <div className="w-[360px] shrink-0 flex flex-col gap-px min-h-0">
        <div className="telemetry-panel p-4 flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Access</span>
            <span className="text-[12px] font-semibold" style={{ color: protectedServer == null ? '#5F7183' : protectedServer ? '#00E85A' : '#FFD000' }}>
              {protectedServer == null ? 'checking' : protectedServer ? 'server asks for a key' : 'server is open'}
            </span>
          </div>
          <p className="text-[13px] text-motorsport-muted leading-relaxed">
            Anyone can watch. Recording, lights, imports, renames and deletes need the control key when the server has one set.
            The key stays in this browser only.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="eng-label">Control key</span>
            <div className="flex gap-2">
              <input
                type="password"
                value={key}
                onChange={e => { setKey(e.target.value); setKeyState('unknown'); }}
                onKeyDown={e => { if (e.key === 'Enter') saveKey(); }}
                placeholder="leave empty on an open server"
                className="flex-1 min-w-0 bg-motorsport-dark border border-motorsport-border px-3 h-9 font-telemetry text-[14px] text-motorsport-text placeholder:text-motorsport-dim focus:outline-none focus:border-motorsport-orange"
              />
              <button onClick={saveKey} className="px-3 h-9 border border-motorsport-border-strong text-[12px] font-bold tracking-wide uppercase text-motorsport-text hover:border-motorsport-orange transition-colors">
                Save
              </button>
            </div>
          </label>
          <span className="text-[13px] font-semibold h-[13px] leading-none" style={{ color: keyState === 'ok' ? '#00E85A' : keyState === 'rejected' ? '#FF2044' : 'transparent' }}>
            {keyState === 'ok' ? 'Key accepted' : keyState === 'rejected' ? 'Key rejected by the server' : '.'}
          </span>
        </div>

        <div className="telemetry-panel p-4 flex flex-col gap-3">
          <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Connection</span>
          <Row label="Backend" value={backendUp == null ? 'checking' : backendUp ? 'reachable' : 'unreachable'} color={backendUp == null ? '#9AACBE' : backendUp ? '#00E85A' : '#FF2044'} />
          <Row label="Game telemetry" value="UDP port 20777 on the server" />
          <Row label="Format" value="F1 23 / F1 24, 2023 packet layout" />
        </div>
      </div>

      {/* ── Right: what to call each circuit ── */}
      <div className="flex-1 min-w-0 telemetry-panel flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-motorsport-border flex items-baseline justify-between">
          <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Track nicknames</span>
          <span className="text-[12px] text-motorsport-muted font-semibold">shown in the header and the recorded list</span>
        </div>
        {writesBlocked && (
          <div className="px-4 py-2 text-[13px] text-motorsport-yellow border-b border-motorsport-border">
            Set a valid control key on the left to save nicknames.
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {orderedTracks.map(t => {
            const draft = drafts[t.id] ?? trackAliases[t.id] ?? '';
            const current = t.id === currentTrackId;
            return (
              <div key={t.id} className={`flex items-center gap-4 px-4 h-11 border-b border-motorsport-border/60 ${current ? 'bg-motorsport-orange/[0.06]' : ''}`}>
                <span className="w-[160px] shrink-0 text-[14px] font-bold tracking-wide text-motorsport-text truncate">
                  {t.name}
                  {current && <span className="ml-2 text-[11px] text-motorsport-orange font-bold uppercase">now</span>}
                </span>
                <input
                  value={draft}
                  maxLength={80}
                  disabled={writesBlocked}
                  onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                  onBlur={() => saveAlias(t.id)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  placeholder="nickname"
                  className="flex-1 min-w-0 max-w-[360px] bg-transparent border-b border-motorsport-border px-1 h-8 text-[14px] text-motorsport-text placeholder:text-motorsport-dim focus:outline-none focus:border-motorsport-orange disabled:opacity-40"
                />
                <span className="w-16 text-[12px] font-semibold text-motorsport-green">{savedId === t.id ? 'saved' : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="eng-label">{label}</span>
      <span className="text-[13px] font-semibold text-right" style={{ color: color ?? '#E8EEF4' }}>{value}</span>
    </div>
  );
}
