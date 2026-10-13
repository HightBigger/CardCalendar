"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

const MODAL_CLOSE_MS = 220;
const modalStack: HTMLElement[] = [];
let modalLayer = 10;
let bodyOverflow = "";

function restoreFocus(previous: HTMLElement | null, current: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    if (current?.isConnected && current.dataset.state === "open") return;
    if (!previous) return;
    const top = modalStack.filter((dialog) => dialog !== current && dialog.isConnected).at(-1);
    if (previous?.isConnected && (!top || top.contains(previous))) previous.focus({ preventScroll: true });
    else top?.focus({ preventScroll: true });
  });
}

function updateModalStack() {
  document.body.dataset.modalDepth = String(modalStack.length);
  for (const dialog of modalStack) dialog.inert = dialog !== modalStack.at(-1);
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  descriptionId?: string;
  className?: string;
  children: ReactNode;
};

export function ModalShell({
  open,
  onClose,
  labelledBy,
  descriptionId,
  className = "",
  children,
}: ModalShellProps) {
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const [layer, setLayer] = useState(10);
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastDialog = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    const dialog = dialogRef.current ?? lastDialog.current;
    restoreFocus(previousFocus.current, dialog);
    if (!dialog?.isConnected) previousFocus.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (!previousFocus.current) {
        previousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      setPresent(true);
      setClosing(false);
      return;
    }

    if (!present) return;
    setClosing(true);
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : MODAL_CLOSE_MS;
    closeTimer.current = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
      restoreFocus(previousFocus.current, dialogRef.current);
      previousFocus.current = null;
      closeTimer.current = null;
    }, closeDelay);

    return () => {
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [open, present]);

  useEffect(() => {
    if (!present) return;
    const body = document.body;
    const dialog = dialogRef.current;
    if (!dialog) return;
    lastDialog.current = dialog;
    if (modalStack.length === 0) bodyOverflow = body.style.overflow;
    modalStack.push(dialog);
    setLayer(++modalLayer);
    updateModalStack();
    body.style.overflow = "hidden";

    return () => {
      const index = modalStack.indexOf(dialog);
      if (index !== -1) modalStack.splice(index, 1);
      updateModalStack();
      if (modalStack.length === 0) body.style.overflow = bodyOverflow;
    };
  }, [present]);

  useEffect(() => {
    if (!open || !present) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const dialogElement = dialog;

    const getFocusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true",
      );
    const focusables = getFocusables();
    const firstControl =
      dialog.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
    (firstControl ?? focusables[0] ?? dialog).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== dialogElement) return;
      if (
        event.key === "Escape" &&
        event.target instanceof Node &&
        dialogElement.contains(event.target)
      ) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (
        event.key !== "Tab" ||
        !(event.target instanceof Node) ||
        !dialogElement.contains(event.target)
      ) {
        return;
      }

      const currentFocusables = getFocusables();
      if (currentFocusables.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }
      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (currentFocusables.length === 1) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, present]);

  if (!present) return null;

  const state = closing ? "closing" : "open";

  return (
    <div
      className={"modal-backdrop" + (closing ? " closing" : "")}
      data-state={state}
      style={{ zIndex: layer }}
      role="presentation"
      onPointerDown={(event) =>
        event.target === event.currentTarget && onCloseRef.current()
      }
    >
      <section
        className={"modal" + (className ? " " + className : "")}
        data-state={state}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={descriptionId}
      >
        {children}
      </section>
    </div>
  );
}
