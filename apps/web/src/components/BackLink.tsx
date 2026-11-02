import { Link } from 'react-router-dom';
import s from './BackLink.module.css';

/**
 * The back button: a small round chevron beside the page title. `label` ("Client Billing")
 * is its tooltip and accessible name. Put `backRow` on the title block that holds it, so it
 * sits to the left of the title and subtitle, centred on them.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={s.back} aria-label={`Back to ${label}`} title={`Back to ${label}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m14.5 6-6 6 6 6" />
      </svg>
    </Link>
  );
}

export const backRow = s.row;
