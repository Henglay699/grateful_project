import { CardToggle } from '../pages/dashboard/parts';
import s from './DirectionToggle.module.css';

const OPTIONS = [
  { value: '', label: 'All' },
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
];

/**
 * The lists' shipment filter as one button, like the Overview's Forwarder Statistics toggle:
 * each click moves All → Import → Export → back. '' means both.
 */
export function DirectionToggle({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (direction: string) => void;
}) {
  return (
    <CardToggle
      label="Shipment"
      value={value ?? ''}
      onChange={onChange}
      options={OPTIONS}
      triggerClass={s.trigger}
    />
  );
}
