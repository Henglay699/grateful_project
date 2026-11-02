export function FullPageLoader({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        color: 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {label}
    </div>
  );
}
