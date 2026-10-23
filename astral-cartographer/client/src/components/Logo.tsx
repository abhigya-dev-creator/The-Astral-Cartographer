export function LogoIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="lg-sphere" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#37D9FF" /><stop offset=".5" stopColor="#386BFF" /><stop offset="1" stopColor="#8755FF" />
        </radialGradient>
        <linearGradient id="lg-ring" x1="0" x2="1">
          <stop offset="0" stopColor="#37D9FF" /><stop offset=".6" stopColor="#8755FF" /><stop offset="1" stopColor="#F39A54" />
        </linearGradient>
      </defs>
      <g transform="rotate(-25 32 32)" fill="none" strokeWidth="2.2" strokeLinecap="round">
        <path d="M4 32 A28 9 0 0 1 60 32" stroke="url(#lg-ring)" opacity=".55" />
        <circle cx="32" cy="32" r="14" fill="url(#lg-sphere)" stroke="none" />
        <path d="M4 32 A28 9 0 0 0 60 32" stroke="url(#lg-ring)" />
      </g>
    </svg>
  );
}
export function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <LogoIcon size={34} />
      <div className="brand-text"><span className="t">The</span><span className="a">Astral</span><span className="c">Cartographer</span></div>
    </div>
  );
}
