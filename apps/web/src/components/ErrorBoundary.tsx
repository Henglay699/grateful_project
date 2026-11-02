import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route path) clears a previous error. */
  resetKey?: string;
}
interface State {
  error: Error | null;
}

/** Catches render errors in a page so the sidebar and top bar stay usable. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="view active">
        <div className="card" style={{ maxWidth: 620 }}>
          <div className="card-header-row">
            <h3>This page couldn’t be displayed</h3>
          </div>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            Something in this page failed to load. Reload to try again; if it keeps happening, send
            the message below to support.
          </p>
          <pre
            style={{
              fontSize: 12,
              color: 'var(--status-exception-fg)',
              whiteSpace: 'pre-wrap',
              marginBottom: 16,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="new-shipment-btn"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </section>
    );
  }
}
