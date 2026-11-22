import { type DragEvent, useEffect, useRef, useState } from "react";

import { useNotes, useRemoveCv, useUploadCv, saveRole } from "../../api/hooks";
import { FileIcon } from "../../app/icons";
import { formatWhen } from "../review/format";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";
import { LoadingRows } from "../../ui/Loading";

export const MAX_CV_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const PREVIEW_CHARS = 1500;

/** Quick checks before sending; the server still decides what the file really is. */
export function checkCvFile(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_CV_BYTES)
    return "That file is over 5 MB. Upload a smaller version.";
  return null;
}

/** The CV and target role. It lives in Settings, under the CV tab. */
export function CvPanel() {
  const { data, isPending, isError } = useNotes();
  const upload = useUploadCv();
  const remove = useRemoveCv();
  const [role, setRole] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data && !loaded) {
      setRole(data.role);
      setLoaded(true);
    }
  }, [data, loaded]);

  const { status, retry } = useAutosave(role, saveRole, { enabled: loaded });

  if (isPending) return <LoadingRows label="Loading your CV" />;
  if (isError)
    return (
      <p role="alert" className="notice-error">
        Couldn&apos;t load your CV. Reload to try again.
      </p>
    );

  const hasText = data.content.trim().length > 0;
  const fromFile = Boolean(data.cv_filename);
  const busy = upload.isPending || remove.isPending;
  const error = problem ?? (upload.error ?? remove.error)?.message ?? null;

  const send = (file: File | undefined) => {
    if (!file) return;
    setConfirmRemove(false);
    const bad = checkCvFile(file);
    setProblem(bad);
    if (!bad) upload.mutate(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) send(e.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Your CV</h2>
      <p className="text-sm text-muted">
        Upload your CV. Your own stories and numbers come only from it (and any
        company brief), and each is labelled with where it came from. Everything
        else is general interview knowledge. We keep the text we read, not the
        file.
      </p>

      <div>
        <label htmlFor="role" className="block text-sm font-medium">
          Target role
        </label>
        <input
          id="role"
          maxLength={200}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="input mt-1 w-full"
          placeholder="e.g. Senior Product Manager"
        />
        <div className="mt-1">
          <SaveIndicator status={status} onRetry={() => void retry()} />
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        aria-label="CV file"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          send(e.target.files?.[0]);
          e.target.value = ""; // choosing the same file again still counts
        }}
      />

      {!hasText ? (
        <section
          aria-labelledby="cv-h"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-2xl p-8 text-center transition-colors ${
            dragging ? "bg-accent-soft shadow-lift" : "bg-canvas"
          }`}
        >
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-dark">
            <FileIcon className="h-6 w-6" />
          </span>
          <h2 id="cv-h" className="text-lg font-semibold">
            Upload your CV
          </h2>
          <p className="mt-1 text-sm text-muted">
            Drop a file here, or choose one. PDF or Word (.docx), up to 5 MB. It
            needs to contain text, not be a scan or a photo.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="btn-primary btn-lg mt-4"
          >
            {upload.isPending ? "Reading your CV…" : "Choose a file"}
          </button>
        </section>
      ) : (
        <section aria-labelledby="cv-h" className="card space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-dark">
              <FileIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="cv-h" className="break-words font-semibold">
                {fromFile ? data.cv_filename : "Notes from before CV uploads"}
              </h2>
              <p className="text-sm text-muted">
                {fromFile && data.cv_uploaded_at
                  ? `Uploaded ${formatWhen(data.cv_uploaded_at)} · `
                  : ""}
                {data.content.length.toLocaleString()} characters read
              </p>
            </div>
          </div>

          {upload.data?.truncated && (
            <p role="status" className="notice-warn">
              Your CV was longer than we can use, so we kept the first{" "}
              {data.content.length.toLocaleString()} characters.
            </p>
          )}
          {!fromFile && (
            <p className="text-sm text-muted">
              These are notes you typed earlier. Upload your CV to replace them.
            </p>
          )}

          <details className="rounded-xl bg-canvas p-3">
            <summary className="cursor-pointer text-sm font-medium">
              See what we read
            </summary>
            <p className="mt-2 text-xs text-muted">
              Check this looks right. Your own experience in an answer can only
              come from this text.
            </p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">
              {data.content.slice(0, PREVIEW_CHARS)}
              {data.content.length > PREVIEW_CHARS ? "…" : ""}
            </pre>
          </details>

          {confirmRemove ? (
            <div className="flex flex-wrap items-center gap-2" role="group">
              <span className="text-sm">Remove your CV?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSettled: () => setConfirmRemove(false),
                  })
                }
                className="btn-danger btn-sm"
              >
                Yes, remove it
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="btn-secondary btn-sm"
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                className="btn-secondary"
              >
                {upload.isPending ? "Reading your CV…" : "Replace CV"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
                className="btn-danger-outline"
              >
                Remove
              </button>
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
    </div>
  );
}
