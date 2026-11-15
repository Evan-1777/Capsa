import React, { useEffect, useRef } from "react";

/** 原生 <dialog> 的模态生命周期：打开时 showModal，卸载时把焦点还原到触发点。 */
function useModalDialog(open: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && open && !dialog.open) {
      prevFocusedRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
  }, [open]);

  useEffect(() => {
    return () => {
      prevFocusedRef.current?.focus?.();
    };
  }, []);

  return dialogRef;
}

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
  const dialogRef = useModalDialog(open);

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
      className={`fixed inset-0 m-0 z-50 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-scrim p-4 ${className}`}
    >
      <div
        className={`w-full max-w-md rounded-xl bg-surface-container-high p-6 text-on-surface ${panelClassName}`}
      >
        {children}
      </div>
    </dialog>
  );
}

export interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * 侧边模态抽屉：<dialog> 自身即模态容器，不套中间包裹层。
 * 这样遮罩点击判定恒为 target === currentTarget，且业务子节点可自行控制窄屏宽度。
 */
export function SideSheet({
  open,
  onClose,
  side = "right",
  children,
  className = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SideSheetProps) {
  const dialogRef = useModalDialog(open);

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
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`max-h-none max-w-none border-0 p-0 m-0 h-screen w-screen fixed inset-0 z-50 flex bg-scrim ${
        side === "right" ? "justify-end" : "justify-start"
      } ${className}`}
    >
      {children}
    </dialog>
  );
}
