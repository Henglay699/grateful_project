import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="view active">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-header-row">
          <h3>Page not found</h3>
        </div>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          The address doesn’t match any page. Use the sidebar, or go back to your start page.
        </p>
        <Link to="/" className="new-shipment-btn" style={{ display: 'inline-flex' }}>
          Go to start page
        </Link>
      </div>
    </section>
  );
}
