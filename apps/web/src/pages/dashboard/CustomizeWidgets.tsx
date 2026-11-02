import { Modal, ui } from '../../components/ui';
import { widgetsFor, type WidgetId } from './widgets';
import s from './CustomizeWidgets.module.css';

/** Overview → Customize: switch each widget on or off; changes show on the page right away. */
export function CustomizeWidgets({
  canProfit,
  shown,
  toggle,
  reset,
  customized,
  onClose,
}: {
  canProfit: boolean;
  shown: (id: WidgetId) => boolean;
  toggle: (id: WidgetId) => void;
  reset: () => void;
  customized: boolean;
  onClose: () => void;
}) {
  const list = widgetsFor(canProfit);
  const count = list.filter((w) => shown(w.id)).length;
  return (
    <Modal
      title="Edit Overview widgets"
      sub={`${count} of ${list.length} widgets shown · saved for you on this browser`}
      onClose={onClose}
      width={520}
    >
      <ul className={s.list}>
        {list.map((w) => (
          <li key={w.id}>
            <label className={s.row}>
              <span className={s.text}>
                <b>{w.label}</b>
                <small>{w.sub}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                className={s.switch}
                checked={shown(w.id)}
                onChange={() => toggle(w.id)}
              />
            </label>
          </li>
        ))}
      </ul>
      <div className={ui.actions}>
        <button
          type="button"
          className="btn-cancel-shipment"
          onClick={reset}
          disabled={!customized}
          title={customized ? 'Show the Overview as it comes' : 'Already the default layout'}
        >
          Reset to default
        </button>
        <button type="button" className="btn-create-submit" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
