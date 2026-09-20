import React, { useEffect, useRef } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  drawer?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function Dialog({
  open,
  onClose,
  children,
  className = "",
  panelClassName = "",
  drawer = false,
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
      className={`fixed inset-0 m-0 h-screen w-screen max-h-none max-w-none border-0 p-0 bg-black/40 backdrop-blur-sm z-50 ${
        drawer ? "flex justify-end" : "flex items-center justify-center p-4"
      } ${className}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${
          drawer
            ? "relative ml-auto flex h-full w-full flex-col bg-surface shadow-dialog md:w-[560px]"
            : "w-full max-w-md rounded-lg border border-stroke bg-surface p-5 shadow-dialog"
        } ${panelClassName}`}
      >
        {children}
      </div>
    </dialog>
  );
}
