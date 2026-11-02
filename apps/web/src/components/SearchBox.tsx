import type { InputHTMLAttributes } from 'react';
import { icons } from '../layout/icons';
import s from './SearchBox.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  /** Classes for the outer box (e.g. to let it take the free width). */
  className?: string;
  /** Stretch across the free width of its toolbar instead of the usual 240px. */
  grow?: boolean;
};

/** Page search field: one bordered box with the icon inside, like the top-bar search. */
export function SearchBox({ className, grow, ...input }: Props) {
  return (
    <label className={[s.box, grow && s.grow, className].filter(Boolean).join(' ')}>
      <input type="search" {...input} />
      {icons.search({})}
    </label>
  );
}
