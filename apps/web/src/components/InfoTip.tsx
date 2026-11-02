import { useId, type ReactNode } from 'react';
import s from './InfoTip.module.css';

/** A circled "!" beside a title; its explanation shows on hover or keyboard focus. */
export function InfoTip({ label = 'More info', children }: { label?: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className={s.wrap}>
      <button type="button" className={s.icon} aria-label={label} aria-describedby={id}>
        !
      </button>
      <span role="tooltip" id={id} className={s.tip}>
        {children}
      </span>
    </span>
  );
}
