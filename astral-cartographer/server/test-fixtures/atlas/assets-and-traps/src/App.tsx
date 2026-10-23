import './App.css';
import logo from './logo.svg';
import cfg from './config.json';
// import nope from './commented-out';
/* import alsoNope from './block-commented'; */
const s = "import fake from './inside-string'";
export default class App {
  method(a: number) { if (a > 1 && a < 5) { return a ?? 0; } return a > 2 ? 1 : 2; }
}
export function helper(xs: number[]) {
  for (const x of xs) { try { switch (x) { case 1: break; case 2: break; default: break; } } catch { } }
  return xs.length || 0;
}
export const arrow = () => logo + cfg + s;
