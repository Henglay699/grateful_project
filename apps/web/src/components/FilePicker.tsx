import { useRef, useState, type DragEvent } from 'react';
import { icons } from '../layout/icons';
import { fmtFileSize } from '../lib/format';
import s from './FilePicker.module.css';

/** Drop zone + click-to-browse replacement for a bare `<input type="file">` (single file). */
export function FilePicker({
  id,
  accept,
  hint,
  file,
  onChange,
}: {
  id: string;
  /** Same format as the input's `accept`: a comma list of extensions, e.g. ".pdf,.xlsx". */
  accept: string;
  /** Small line under the prompt, e.g. "PDF, Excel or Word · up to 20 MB". */
  hint?: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);

  const allowed = accept.split(',').map((x) => x.trim().toLowerCase());
  const pick = (f: File | null) => {
    // The browse dialog filters by `accept`; a dropped file has to be checked here.
    const ok = !f || allowed.some((ext) => f.name.toLowerCase().endsWith(ext));
    setRejected(!ok);
    if (ok) onChange(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0] ?? null);
  };

  const clear = () => {
    if (inputRef.current) inputRef.current.value = '';
    setRejected(false);
    onChange(null);
  };

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className={s.input}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className={s.chosen}>
          <span className={s.fileIcon}>{icons.documents({})}</span>
          <span className={s.fileText}>
            <span className={s.fileName} title={file.name}>
              {file.name}
            </span>
            <span className={s.fileMeta}>
              {extOf(file.name)} · {fmtFileSize(file.size)}
            </span>
          </span>
          <label htmlFor={id} className={s.change}>
            Change
          </label>
          <button type="button" className={s.remove} onClick={clear} aria-label="Remove file">
            {icons.close({})}
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={`${s.zone}${dragging ? ` ${s.dragging}` : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className={s.zoneIcon}>{icons.upload({})}</span>
          <span className={s.prompt}>
            <strong>Click to choose a file</strong> or drag it here
          </span>
          {hint && <span className={s.hint}>{hint}</span>}
        </label>
      )}
      {rejected && (
        <span className={s.error}>That file type isn’t allowed here ({allowed.join(', ')}).</span>
      )}
    </div>
  );
}

function extOf(name: string) {
  const ext = /\.([^.]+)$/.exec(name)?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}
