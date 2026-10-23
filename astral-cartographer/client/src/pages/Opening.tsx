import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StarNetwork from '../components/StarNetwork';
import { BACKGROUNDS } from '../lib/backgrounds';

// Seconds after load: stars awaken (1.3 s), lines form (2.7 to 5.3 s), then the text appears.
const CUES = [5.4, 5.7, 6.05, 6.7, 7.4];
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Opening() {
  const [shown, setShown] = useState(REDUCED ? CUES.length : 0);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();
  const bg = new URLSearchParams(location.search).get('bg') === '1' ? BACKGROUNDS[1] : BACKGROUNDS[2];

  useEffect(() => {
    if (REDUCED) return;
    const timers = CUES.map((t, i) => setTimeout(() => setShown(i + 1), t * 1000));
    return () => timers.forEach(clearTimeout);
  }, []);

  const cls = (i: number) => `reveal${shown > i ? ' in' : ''}`;
  const go = () => { setLeaving(true); setTimeout(() => navigate('/auth'), REDUCED ? 0 : 600); };

  return (
    <div className="opening" style={{ backgroundImage: `url(${bg.url})`, opacity: leaving ? 0 : undefined, transition: 'opacity .6s' }}>
      <StarNetwork imageAspect={bg.aspect} reduced={REDUCED} />
      <div className="opening-inner">
        <h1 style={{ margin: 0, fontWeight: 300 }} aria-label="The Astral Cartographer">
          <span className={`o-the ${cls(0)}`} style={{ display: 'block' }} aria-hidden="true">THE</span>
          <span className={`o-astral ${cls(1)}`} style={{ display: 'block' }} aria-hidden="true">ASTRAL</span>
          <span className={`o-carto ${cls(2)}`} style={{ display: 'block' }} aria-hidden="true">CARTOGRAPHER</span>
        </h1>
        <p className={`o-tag ${cls(3)}`}>Discover the connections hidden in your code.</p>
        <button className={`btn-primary ${cls(4)}`} onClick={go}>Get Started <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}
