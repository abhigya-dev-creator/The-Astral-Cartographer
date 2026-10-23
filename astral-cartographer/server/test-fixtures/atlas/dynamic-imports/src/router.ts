export async function load(name: string) {
  const lazy = await import('./pages/Lazy');
  const tpl = await import(`./pages/Static`);
  const page = await import(`./pages/${name}`);
  return [lazy, tpl, page];
}
