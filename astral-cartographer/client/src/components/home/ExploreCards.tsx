import { Link } from 'react-router-dom';
import { Activity, ArrowRight, ChartNoAxesCombined, Code2, Compass, Network, Settings2 } from 'lucide-react';

// Only routes registered in App.tsx are linked here.
const CARDS = [
  { to: '/atlas', title: 'Dependency Atlas', text: 'Visualize file and function dependencies', Icon: Network, fg: '#6898FF', rgb: '56, 107, 255' },
  { to: '/explorer', title: 'Code Explorer', text: 'Browse and understand source code', Icon: Code2, fg: '#A99AFF', rgb: '139, 120, 255' },
  { to: '/health', title: 'Architectural Health', text: 'Find risks and improve structure', Icon: Activity, fg: '#FFAD66', rgb: '255, 173, 102' },
  { to: '/pathfinder', title: 'Onboarding Pathfinder', text: 'Get a guided learning path', Icon: Compass, fg: '#37D9FF', rgb: '55, 217, 255' },
  { to: '/reports', title: 'Reports & Benchmarks', text: 'View detailed reports and comparisons', Icon: ChartNoAxesCombined, fg: '#6898FF', rgb: '104, 152, 255' },
  { to: '/settings', title: 'Settings', text: 'Configure analysis preferences', Icon: Settings2, fg: '#B8BBCB', rgb: '184, 187, 203' },
];

export default function ExploreCards() {
  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F3F6FF', marginBottom: 16, letterSpacing: '-0.01em' }}>
        Explore the Universe
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 16 }}>
        {CARDS.map(({ to, title, text, Icon, fg, rgb }) => (
          <Link
            key={to}
            to={to}
            className="card"
            style={{
              padding: '18px 16px',
              borderRadius: 14,
              background: 'rgba(7, 12, 27, 0.72)',
              border: '1px solid rgba(135, 155, 255, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 140,
              transition: 'all 0.16s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.borderColor = `rgba(${rgb}, 0.5)`;
              e.currentTarget.style.boxShadow = `0 10px 30px rgba(${rgb}, 0.2)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.borderColor = 'rgba(135, 155, 255, 0.2)';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            <div>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `rgba(${rgb}, 0.2)`,
                  display: 'grid',
                  placeItems: 'center',
                  color: fg,
                  marginBottom: 12,
                }}
              >
                <Icon size={16} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F3F6FF', marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 11, color: '#8898B0', lineHeight: 1.4 }}>{text}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: `rgba(${rgb}, 0.25)`,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#FFFFFF',
                }}
              >
                <ArrowRight size={12} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
