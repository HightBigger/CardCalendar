"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

const TOAST_CLOSE_MS = 200;

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: ToastProps) {
  const [present, setPresent] = useState(Boolean(message));
  const [closing, setClosing] = useState(false);
  const [displayMessage, setDisplayMessage] = useState(message ?? "");

  useEffect(() => {
    if (message) {
      setDisplayMessage(message);
      setPresent(true);
      setClosing(false);
      return;
    }

    if (!present) return;
    setClosing(true);
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : TOAST_CLOSE_MS;
    const timer = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
      setDisplayMessage("");
    }, closeDelay);
    return () => window.clearTimeout(timer);
  }, [message, present]);

  if (!present) return null;

  return (
    <div
      className={"toast" + (closing ? " closing" : "")}
      data-state={closing ? "closing" : "open"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon name="check" size={16} />
      <span>{displayMessage}</span>
      <button onClick={onDismiss} aria-label="关闭提示">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
