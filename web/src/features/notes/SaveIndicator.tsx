import type { SaveStatus } from "./useAutosave";

const TEXT: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Could not save.",
};

export function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  return (
    <span role="status" aria-live="polite" className="text-sm text-gray-600">
      {TEXT[status]}
      {status === "error" && (
        <button className="ml-2 underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  );
}
