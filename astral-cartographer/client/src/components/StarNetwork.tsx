import { useEffect, useRef } from 'react';
import { Constellation, Link, NodeDef } from '../lib/constellation';

// Positions calibrated to real bright stars in the new galaxy background across all 8 directions:
const NODES: NodeDef[] = [
  // 0: NW - Brilliant upper-left blue star with diffraction spikes
  { x: 0.213, y: 0.241, tone: 'b', size: 6.0 },
  // 1: NW2 - Golden-warm star
  { x: 0.357, y: 0.153, tone: 'w', size: 4.5 },
  // 2: N - Top bright blue star
  { x: 0.625, y: 0.062, tone: 'b', size: 6.0 },
  // 3: NE - Bright blue star with 4-point spike
  { x: 0.800, y: 0.174, tone: 'b', size: 6.5 },
  // 4: E - Golden-orange star in cosmic cloud
  { x: 0.878, y: 0.464, tone: 'w', size: 5.5 },
  // 5: SE - Brilliant white-violet cross star with large spikes
  { x: 0.678, y: 0.616, tone: 'v', size: 8.0 },
  // 6: SE2 - Lower-right nebula star
  { x: 0.899, y: 0.658, tone: 'b', size: 4.5 },
  // 7: S - Bottom bright blue star
  { x: 0.318, y: 0.931, tone: 'b', size: 5.5 },
  // 8: SW - Mid-southwest blue star
  { x: 0.227, y: 0.635, tone: 'b', size: 6.5 },
  // 9: SW2 - Bottom-left spike star
  { x: 0.059, y: 0.899, tone: 'b', size: 4.5 },
  // 10: W - Warm golden star
  { x: 0.255, y: 0.550, tone: 'w', size: 5.0 },
  // 11: S_Inner - Mid-south blue anchor
  { x: 0.415, y: 0.470, tone: 'b', size: 4.5 },
  // 12: Central Hub - Anchor star positioned below title and above Get Started button
  { x: 0.500, y: 0.735, tone: 'v', size: 7.5 },
];

const LINKS: Link[] = [
  // Outer perimeter connecting all 8 directions in clockwise sequence:
  // NW(0) -> NW2(1) -> N(2) -> NE(3) -> E(4) -> SE2(6) -> SE(5) -> S(7) -> SW2(9) -> SW(8) -> W(10) -> NW(0)
  [0, 1, 0.08],
  [1, 2, 0.12],
  [2, 3, 0.10],
  [3, 4, 0.11],
  [4, 6, 0.10],
  [6, 5, 0.08],
  [5, 7, 0.14],
  [7, 9, 0.10],
  [9, 8, 0.08],
  [8, 10, 0.10],
  [10, 0, 0.12],

  // Broad constellation cross-chords connecting directions:
  [0, 2, 0.18],   // NW to N
  [2, 4, 0.18],   // N to E
  [3, 5, 0.16],   // NE to SE
  [5, 8, 0.15],   // SE to SW
  [8, 0, 0.16],   // SW to NW
  [10, 11, 0.10], // W to S-inner
  [11, 5, 0.12],  // S-inner to SE
  [11, 7, 0.08],  // S-inner to S

  // Central hub connecting to every one of the 8 directions:
  [2, 12, 0.06],  // North -> Hub
  [3, 12, 0.05],  // North-East -> Hub
  [4, 12, 0.04],  // East -> Hub
  [5, 12, 0.03],  // South-East -> Hub
  [7, 12, 0.02],  // South -> Hub
  [8, 12, 0.04],  // South-West -> Hub
  [10, 12, 0.05], // West -> Hub
  [0, 12, 0.07],  // North-West -> Hub
];

export default function StarNetwork({ imageAspect, reduced }: { imageAspect: number; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = new Constellation(ref.current!, { imageAspect, nodes: NODES, links: LINKS, reduced });
    c.start();
    return () => c.stop();
  }, [imageAspect, reduced]);
  return <canvas ref={ref} className="star-network" aria-hidden="true" />;
}
