import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, Bell, ChartNoAxesCombined, Code2, Compass, House, Network, Settings2, LogOut, User as UserIcon, Search } from 'lucide-react';
import { Brand } from './Logo';
import { useAuth } from '../context/AuthContext';
import { useRepositoryStore } from '../context/repositoryStore';

const NAV = [
  { to: '/home', label: 'Home', tip: 'Return to your dashboard.', Icon: House },
  { to: '/atlas', label: 'Dependency Atlas', tip: 'Explore how files and modules connect.', Icon: Network },
  { to: '/explorer', label: 'Code Explorer', tip: 'Browse repository files and understand the code.', Icon: Code2 },
  { to: '/health', label: 'Architectural Health', tip: 'Find structural risks and maintainability issues.', Icon: Activity },
  { to: '/pathfinder', label: 'Onboarding Pathfinder', tip: 'Discover where to start and what to explore next.', Icon: Compass },
  { to: '/reports', label: 'Reports & Benchmarks', tip: 'Review analysis results and compare changes.', Icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Settings', tip: 'Configure your workspace and analysis preferences.', Icon: Settings2 },
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { searchQuery, setSearchQuery } = useRepositoryStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.user_name ||
    user?.email?.split('@')[0] ||
    'Cartographer';
  const initial = displayName.charAt(0).toUpperCase();
  const provider = user?.app_metadata?.provider;
  const isGithubUser = provider === 'github' || Boolean(user?.user_metadata?.user_name);
  const isGoogleUser = provider === 'google';

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Brand /></div>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ to, label, tip, Icon }) => (
            <NavLink key={to} to={to} title={tip} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} strokeWidth={1.8} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="quote">“Every codebase<br />is a universe.<br />We help you map it.”</div>
      </aside>
      <div className="main">
        <header className="topbar">
          {/* Repository Search input matching screenshot */}
          <div className="topbar-search">
            <Search size={15} color="#77839C" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search repositories"
            />
          </div>

          <button className="icon-btn" title="View available notifications." aria-label="Notifications">
            <Bell size={18} strokeWidth={1.8} />
          </button>

          {/* User Profile Avatar & Dropdown */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              type="button"
              className="avatar"
              onClick={() => setMenuOpen(!menuOpen)}
              title={`${displayName} (${user?.email || 'Authenticated'})`}
              style={{
                cursor: 'pointer',
                border: '1px solid rgba(184, 162, 255, 0.5)',
                overflow: 'hidden',
                padding: 0,
              }}
              aria-label="User account menu"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                initial
              )}
            </button>

            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 10px)',
                  right: 0,
                  width: 240,
                  background: 'rgba(7, 12, 27, 0.95)',
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  border: '1px solid rgba(135, 155, 255, 0.25)',
                  borderRadius: 14,
                  padding: 14,
                  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: '1px solid rgba(135, 155, 255, 0.15)' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: 'var(--gradient-primary)',
                      border: '1px solid rgba(184, 162, 255, 0.5)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 600,
                      color: '#FFF',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      initial
                    )}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#F3F6FF', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: 11, color: '#A7B4CC', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {user?.email || 'Signed in'}
                    </div>
                  </div>
                </div>

                {isGithubUser && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8B78FF' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                    <span>Authenticated via GitHub</span>
                  </div>
                )}

                {isGoogleUser && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6898FF' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Authenticated via Google</span>
                  </div>
                )}

                <NavLink
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#B8BBCB',
                    padding: '6px 8px',
                    borderRadius: 6,
                    transition: 'all 0.14s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#EAF0FF';
                    e.currentTarget.style.background = 'rgba(56, 107, 255, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#B8BBCB';
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <UserIcon size={14} /> Profile Settings
                </NavLink>

                <button
                  type="button"
                  onClick={handleSignOut}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#FF717A',
                    background: 'none',
                    border: 'none',
                    padding: '8px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'all 0.14s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 113, 122, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="page"><Outlet /></main>
      </div>
    </div>
  );
}
