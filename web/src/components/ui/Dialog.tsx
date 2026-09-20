import React, { useEffect, useRef } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function Dialog({
  open,
  onClose,
  children,
  className = "",
  panelClassName = "",
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        prevFocusedRef.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
        prevFocusedRef.current?.focus?.();
      }
    }
  }, [open]);

  const handleCancel = (event: React.SyntheticEvent) => {
    event.preventDefault();
    onClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={`fixed inset-0 m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm z-50 ${className}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-lg border border-stroke bg-surface p-5 shadow-dialog ${panelClassName}`}
      >
        {children}
      </div>
    </dialog>
  );
}
