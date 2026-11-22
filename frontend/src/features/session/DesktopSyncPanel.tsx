import { useState } from "react";
import { apiFetch } from "../../api/client";

export interface SessionPinInfo {
  session_id: string;
  pin: string;
  formatted_pin: string;
  connected_clients: number;
}

export function DesktopSyncPanel({
  sessionId,
  ended,
}: {
  sessionId: string;
  ended: boolean;
}) {
  const [data, setData] = useState<SessionPinInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testSent, setTestSent] = useState(false);

  if (ended) return null;

  const fetchPin = async () => {
    if (!sessionId || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch<SessionPinInfo>(
        `/api/sessions/${sessionId}/pin`,
      );
      setData(res);
    } catch {
      /* failed to load pin */
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!data?.formatted_pin) return;
    try {
      await navigator.clipboard.writeText(data.formatted_pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard write blocked */
    }
  };

  const handleTest = async () => {
    try {
      await apiFetch<{ status: string }>(
        `/api/sessions/${sessionId}/test-desktop`,
        {
          method: "POST",
        },
      );
      setTestSent(true);
      setTimeout(() => setTestSent(false), 2500);
    } catch {
      /* test failed */
    }
  };

  const isConnected = (data?.connected_clients ?? 0) > 0;

  return (
    <section aria-labelledby="desktop-sync-h" className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2
          id="desktop-sync-h"
          className="text-base font-semibold flex items-center gap-2"
        >
          <span>Desktop Stealth HUD</span>
          {data && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isConnected
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {isConnected
                ? `Connected (${data.connected_clients} active)`
                : "Waiting for connection"}
            </span>
          )}
        </h2>
      </div>

      <p className="text-xs text-muted">
        Connect the <strong>AudioCore</strong> desktop app to project live AI
        outlines directly onto your screen, invisible to screen share.
      </p>

      {!data ? (
        <div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={fetchPin}
            disabled={loading}
          >
            {loading ? "Generating PIN…" : "Get Desktop Sync PIN"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 bg-canvas p-2.5 rounded-lg">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
              Sync PIN
            </div>
            <div className="text-xl font-mono font-bold tracking-widest text-primary">
              {data.formatted_pin}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleCopy}
              aria-label="Copy Desktop Sync PIN"
            >
              {copied ? "Copied! ✓" : "Copy PIN"}
            </button>
            {isConnected && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleTest}
              >
                {testSent ? "Test Sent! ✓" : "Test Overlay"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
