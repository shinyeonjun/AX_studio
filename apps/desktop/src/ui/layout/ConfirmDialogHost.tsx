import { useEffect, useRef, useState } from 'react';
import { usePendingConfirm } from '../lib/confirm-dialog';

/** The single place app confirmations appear; mounted once at the app root. */
export function ConfirmDialogHost() {
  const pending = usePendingConfirm();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [optionChecked, setOptionChecked] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending) {
      setOptionChecked(pending.request.option?.checked ?? false);
      // showModal focuses the first control (the checkbox or 취소), so Enter never confirms a deletion.
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pending]);

  const answer = (confirmed: boolean) => pending?.resolve({ confirmed, optionChecked: confirmed && optionChecked });
  const request = pending?.request;

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        answer(false);
      }}
    >
      {request && (
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); answer(true); }}>
          <h2 id="confirm-dialog-title" className="confirm-dialog__title">{request.title}</h2>
          {request.message && <p className="confirm-dialog__message">{request.message}</p>}
          {request.option && (
            <label className="confirm-dialog__option">
              <input type="checkbox" checked={optionChecked} onChange={(event) => setOptionChecked(event.target.checked)} />
              {request.option.label}
            </label>
          )}
          <div className="confirm-dialog__actions">
            <button type="button" className="btn btn-secondary" onClick={() => answer(false)}>취소</button>
            <button type="submit" className={`btn ${request.danger ? 'btn-danger-fill' : 'btn-primary'}`}>
              {request.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
