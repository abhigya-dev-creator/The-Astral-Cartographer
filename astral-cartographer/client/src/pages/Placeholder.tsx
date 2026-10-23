export default function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">{subtitle}</p>
      <div className="card" style={{ color: 'var(--color-text-muted)' }}>This page is built in a later stage.</div>
    </>
  );
}
