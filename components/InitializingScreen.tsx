export function InitializingScreen() {
  return (
    <main className="screen">
      <div className="card" aria-busy="true" role="status">
        <h1>Ramesh&apos;s Bakery</h1>
        <p className="muted">Loading your loyalty card…</p>
        <div className="row">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Securely starting your session</span>
        </div>
      </div>
    </main>
  );
}