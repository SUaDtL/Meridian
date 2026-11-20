import { createContext } from "react";
import { Check, CircleAlert, X } from "lucide-react";

export type Notice = {
  message: string;
  tone: "success" | "error";
  action?: { label: string; run: () => void };
};

export const NoticeContext = createContext<{
  notice: Notice | null;
  dismiss: () => void;
  registerModal: () => () => void;
}>({ notice: null, dismiss: () => {}, registerModal: () => () => {} });

export function NoticeMessage({
  notice,
  onDismiss,
  inline = false,
}: {
  notice: Notice | null;
  onDismiss: () => void;
  inline?: boolean;
}) {
  if (!notice) return null;
  return (
    <div
      className={`toast ${notice.tone === "error" ? "toast-error" : ""} ${inline ? "notice-inline" : ""}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.tone === "error" ? (
        <CircleAlert size={17} />
      ) : (
        <Check size={17} />
      )}
      <span>{notice.message}</span>
      {notice.action && (
        <button className="toast-action" onClick={notice.action.run}>
          {notice.action.label}
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
