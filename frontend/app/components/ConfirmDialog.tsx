"use client";
import { Alert, Modal } from "./Modal";

export function ConfirmDialog({
  title,
  subject,
  explanation,
  keepLabel,
  confirmLabel,
  busy,
  error,
  confirm,
  close,
}: {
  title: string;
  subject: string;
  explanation: string;
  keepLabel: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  confirm: () => void;
  close: () => void;
}) {
  return (
    <Modal title={title} close={close}>
      <p>{subject}</p>
      <p className="muted">{explanation}</p>
      <Alert error={error} />
      <div className="card-actions">
        <button className="button outline" onClick={close}>
          {keepLabel}
        </button>
        <button className="button dark" disabled={busy} onClick={confirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
