import { useEffect, useRef, useState } from "react";
import { type LiveSessionController } from "./controller";
import { useLiveStore } from "./store";
import { answerOf } from "./answerText";
import { useStealthHud } from "./useStealthHud";

// macOS Window Traffic Light Header
function MacTrafficLights({
  onClose,
  onMinimize,
  onMaximize,
}: {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "7px",
        WebkitAppRegion: "no-drag" as React.CSSProperties["WebkitAppRegion"],
      }}
    >
      <button
        type="button"
        onClick={onClose}
        title="Exit Stealth Mode"
        aria-label="Exit Stealth"
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: "#ff5f56",
          border: "1px solid #e0443e",
          cursor: "pointer",
          padding: 0,
          outline: "none",
          boxShadow: "0 0 6px rgba(255, 95, 86, 0.4)",
        }}
      />
      <button
        type="button"
        onClick={onMinimize}
        title="Toggle opacity"
        aria-label="Toggle opacity"
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: "#ffbd2e",
          border: "1px solid #dea125",
          cursor: "pointer",
          padding: 0,
          outline: "none",
          boxShadow: "0 0 6px rgba(255, 189, 46, 0.4)",
        }}
      />
      <button
        type="button"
        onClick={onMaximize}
        title="Reset opacity (92%)"
        aria-label="Reset opacity"
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: "#27c93f",
          border: "1px solid #1aab29",
          cursor: "pointer",
          padding: 0,
          outline: "none",
          boxShadow: "0 0 6px rgba(39, 201, 63, 0.4)",
        }}
      />
    </div>
  );
}

// Stealth status badge displaying capture exclusion state
function StealthBadge() {
  return (
    <div
      title="Window completely excluded from screen shares & proctoring tools (WDA_EXCLUDEFROMCAPTURE / NSWindowSharingNone)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "11px",
        padding: "2px 8px",
        borderRadius: "999px",
        backgroundColor: "rgba(52, 211, 153, 0.15)",
        border: "1px solid rgba(52, 211, 153, 0.35)",
        color: "#34d399",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <span style={{ fontSize: "9px" }}>●</span>
      <span>Hidden</span>
    </div>
  );
}

export function StealthTerminalHud({
  controller,
  onEnd,
  onExitStealth,
}: {
  controller: LiveSessionController;
  onEnd: () => void;
  onExitStealth: () => void;
}) {
  const { state: stealthState, toggleClickThrough } = useStealthHud();
  const {
    status,
    level,
    mic,
    micLevel,
    outline,
    lines,
    partial,
    turnStart,
    problem,
    notice,
  } = useLiveStore();

  const [activeTab, setActiveTab] = useState<"copilot" | "transcript">("copilot");
  const [opacity, setOpacity] = useState(92);
  const [fontSize, setFontSize] = useState(13);
  const [showPreferences, setShowPreferences] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);

  const currentAnswerText = outline ? answerOf(outline.text, outline.state === "streaming") : "";

  // Auto-scroll feed on new tokens or speech
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [currentAnswerText, partial, lines, activeTab]);

  const handleCopyAnswer = async () => {
    if (!currentAnswerText) return;
    try {
      await navigator.clipboard.writeText(currentAnswerText);
      setCopiedAnswer(true);
      setTimeout(() => setCopiedAnswer(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  // Find the active or most recent question asked
  const recentPartnerQuestion = outline?.question ||
    lines
      .slice(turnStart)
      .filter((l) => l.speaker === "partner" || l.speaker === "typed")
      .map((l) => l.text)
      .join(" ");

  const sessionEnded = status === "ended";

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        boxSizing: "border-box",
        backgroundColor: `rgba(28, 27, 46, ${opacity / 100})`,
        color: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        borderRadius: "16px",
        border: stealthState.clickThrough
          ? "1px solid rgba(123, 71, 243, 0.7)"
          : "1px solid rgba(255, 255, 255, 0.12)",
        boxShadow: stealthState.clickThrough
          ? "0 0 25px rgba(123, 71, 243, 0.35), 0 25px 60px -15px rgba(0, 0, 0, 0.85)"
          : "0 25px 60px -15px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        overflow: "hidden",
        userSelect: stealthState.clickThrough ? "none" : "text",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Top Apple Terminal Title & Controls Bar */}
      <div
        style={{
          height: "42px",
          padding: "0 14px",
          backgroundColor: "rgba(0, 0, 0, 0.25)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          WebkitAppRegion: "drag" as React.CSSProperties["WebkitAppRegion"],
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <MacTrafficLights
            onClose={onExitStealth}
            onMinimize={() => setOpacity((prev) => (prev <= 50 ? 92 : 45))}
            onMaximize={() => setOpacity(92)}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "#c4b5fd",
            }}
          >
            <span style={{ color: "#7b47f3" }}>●</span>
            <span>LIVE HUD</span>
          </div>

          <StealthBadge />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            WebkitAppRegion: "no-drag" as React.CSSProperties["WebkitAppRegion"],
          }}
        >
          {/* Click-Through Toggle Button */}
          <button
            type="button"
            onClick={() => void toggleClickThrough()}
            title={
              stealthState.clickThrough
                ? "Click-through is ON. Mouse clicks pass through directly to background windows (⌘⇧M)"
                : "Click-through is OFF. You can scroll, copy, and interact (⌘⇧M)"
            }
            style={{
              padding: "4px 9px",
              fontSize: "10px",
              fontWeight: 600,
              backgroundColor: stealthState.clickThrough ? "#7b47f3" : "rgba(255, 255, 255, 0.08)",
              color: stealthState.clickThrough ? "#ffffff" : "#cbd5e1",
              border: `1px solid ${stealthState.clickThrough ? "#9061f9" : "rgba(255, 255, 255, 0.12)"}`,
              borderRadius: "6px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {stealthState.clickThrough ? "Click-thru ON" : "Interactive"}
          </button>

          {/* Exit Stealth Mode Button */}
          <button
            type="button"
            onClick={onExitStealth}
            title="Restore full application window"
            style={{
              padding: "4px 8px",
              fontSize: "10px",
              fontWeight: 600,
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              color: "#cbd5e1",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* Segmented View Switcher: Copilot Feed vs Live Transcript */}
      <div
        style={{
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          backgroundColor: "rgba(0, 0, 0, 0.2)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("copilot")}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              borderRadius: "6px",
              border: activeTab === "copilot" ? "1px solid rgba(123, 71, 243, 0.5)" : "1px solid transparent",
              backgroundColor: activeTab === "copilot" ? "rgba(123, 71, 243, 0.25)" : "transparent",
              color: activeTab === "copilot" ? "#c4b5fd" : "#94a3b8",
              cursor: "pointer",
            }}
          >
            Copilot Feed
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transcript")}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              borderRadius: "6px",
              border: activeTab === "transcript" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
              backgroundColor: activeTab === "transcript" ? "rgba(56, 189, 248, 0.15)" : "transparent",
              color: activeTab === "transcript" ? "#38bdf8" : "#94a3b8",
              cursor: "pointer",
            }}
          >
            Transcript ({lines.length})
          </button>
        </div>

        {currentAnswerText && activeTab === "copilot" && (
          <button
            type="button"
            onClick={() => void handleCopyAnswer()}
            title="Copy answer to clipboard"
            style={{
              background: "none",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              color: copiedAnswer ? "#34d399" : "#cbd5e1",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>{copiedAnswer ? "✓ Copied" : "📋 Copy"}</span>
          </button>
        )}
      </div>

      {/* Scrollable Conversation & Answer Feed */}
      <div
        ref={feedRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          fontSize: `${fontSize}px`,
          lineHeight: "1.6",
        }}
      >
        {/* Session Ended Alert Banner */}
        {sessionEnded && (
          <div
            style={{
              padding: "12px 14px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              fontSize: "12px",
              color: "#fecaca",
            }}
          >
            <span>Interview session concluded.</span>
            <button
              type="button"
              onClick={onExitStealth}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "#7b47f3",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Review Session
            </button>
          </div>
        )}

        {/* Detected Interviewer Question Pill Card */}
        {(recentPartnerQuestion || partial) && (
          <div
            style={{
              padding: "12px 14px",
              backgroundColor: "rgba(30, 41, 59, 0.7)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderLeft: "4px solid #f59e0b",
              borderRadius: "10px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#fbbf24",
                fontWeight: 700,
                marginBottom: "4px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>●</span>
              <span>Interviewer Question</span>
            </div>
            <div style={{ color: "#f8fafc", fontWeight: 500 }}>
              {recentPartnerQuestion || (partial ? <span className="italic text-muted">{partial}…</span> : "")}
            </div>
          </div>
        )}

        {/* Tab 1: Copilot Feed */}
        {activeTab === "copilot" ? (
          <>
            {/* Outline Answer Card */}
            {outline && currentAnswerText ? (
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "rgba(18, 17, 34, 0.85)",
                  border: "1px solid rgba(123, 71, 243, 0.4)",
                  borderLeft: "4px solid #7b47f3",
                  borderRadius: "12px",
                  color: "#f1f5f9",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.7",
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "#a78bfa",
                    marginBottom: "8px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>●</span>
                    <span>AI Answer Outline {outline.state === "streaming" ? "(Thinking…)" : ""}</span>
                  </div>
                  {outline.firstWordsMs !== undefined && (
                    <span style={{ opacity: 0.6 }}>{(outline.firstWordsMs / 1000).toFixed(1)}s</span>
                  )}
                </div>

                <div style={{ fontWeight: 400 }}>{currentAnswerText}</div>

                {outline.flags.length > 0 && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "8px 10px",
                      backgroundColor: "rgba(245, 158, 11, 0.15)",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      borderRadius: "6px",
                      fontSize: "11px",
                      color: "#fde68a",
                    }}
                  >
                    Check these points (not in CV):
                    <ul style={{ listStyleType: "disc", paddingLeft: "16px", margin: "4px 0 0" }}>
                      {outline.flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => controller.markDone()}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      backgroundColor: "#7b47f3",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      fontWeight: 600,
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    Done, next question
                  </button>
                  <button
                    type="button"
                    onClick={() => controller.regenerate()}
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                      color: "#cbd5e1",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: "12px",
                }}
              >
                <div style={{ marginBottom: "6px", fontSize: "18px" }}>🎙️</div>
                {status === "listening" || status === "reconnecting" ? (
                  <span>Listening for interviewer questions... Outlines will appear here automatically.</span>
                ) : status === "starting" ? (
                  <span>Starting…</span>
                ) : status === "ended" ? (
                  <span>Session ended.</span>
                ) : (
                  // idle, stopped or failed: say so, with the reason, and let the person start again
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    {problem ? (
                      <span role="alert" style={{ color: "#fca5a5" }}>{problem}</span>
                    ) : (
                      <span>Not listening yet.</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void controller.share()}
                      style={{
                        padding: "8px 14px",
                        backgroundColor: "#7b47f3",
                        color: "#ffffff",
                        border: "1px solid #9061f9",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Start listening
                    </button>
                  </div>
                )}
                {notice && (status === "listening" || status === "reconnecting") && (
                  <div style={{ marginTop: "8px", color: "#fcd34d" }}>{notice}</div>
                )}
              </div>
            )}

            {/* Recent conversation turns */}
            {lines.slice(-3).map((item) => {
              const isYou = item.speaker === "you";
              if (item.speaker === "gap") return null;
              return (
                <div
                  key={item.key}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: isYou ? "rgba(123, 71, 243, 0.12)" : "rgba(30, 41, 59, 0.5)",
                    border: `1px solid ${isYou ? "rgba(123, 71, 243, 0.25)" : "rgba(255, 255, 255, 0.08)"}`,
                    borderLeft: `4px solid ${isYou ? "#a78bfa" : "#64748b"}`,
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: isYou ? "#c4b5fd" : "#cbd5e1",
                      marginBottom: "2px",
                    }}
                  >
                    <span>{isYou ? "You" : "Partner"}</span>
                  </div>
                  <div style={{ color: "#f1f5f9" }}>{item.text}</div>
                </div>
              );
            })}
          </>
        ) : (
          /* Tab 2: Full Live Transcript */
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {lines.map((l) => {
              if (l.speaker === "gap") {
                return (
                  <div key={l.key} style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic" }}>
                    {l.text}
                  </div>
                );
              }
              const isYou = l.speaker === "you";
              return (
                <div
                  key={l.key}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: isYou ? "rgba(123, 71, 243, 0.12)" : "rgba(30, 41, 59, 0.4)",
                    border: `1px solid ${isYou ? "rgba(123, 71, 243, 0.25)" : "rgba(255, 255, 255, 0.08)"}`,
                    borderRadius: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: isYou ? "#c4b5fd" : "#94a3b8",
                      marginBottom: "2px",
                    }}
                  >
                    {isYou ? "You" : "Partner"}
                  </div>
                  <div style={{ color: "#f1f5f9" }}>{l.text}</div>
                </div>
              );
            })}
            {partial && (
              <div
                style={{
                  padding: "8px 12px",
                  fontStyle: "italic",
                  color: "#94a3b8",
                  backgroundColor: "rgba(30, 41, 59, 0.3)",
                  borderRadius: "8px",
                }}
              >
                <strong style={{ color: "#cbd5e1" }}>Partner:</strong> {partial}…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preferences Drawer */}
      {showPreferences && (
        <div
          style={{
            padding: "12px 14px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            backgroundColor: "rgba(0, 0, 0, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            fontSize: "11px",
          }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", marginBottom: "4px" }}>
              <span>Glassmorphism Opacity</span>
              <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{opacity}%</span>
            </div>
            <input
              type="range"
              min="30"
              max="100"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#7b47f3", cursor: "pointer" }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#94a3b8" }}>Font Size</span>
            <div style={{ display: "flex", gap: "6px" }}>
              {[11, 13, 15].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFontSize(s)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    border: fontSize === s ? "1px solid #7b47f3" : "1px solid rgba(255, 255, 255, 0.12)",
                    backgroundColor: fontSize === s ? "#7b47f3" : "transparent",
                    color: "#ffffff",
                    fontSize: "10px",
                    cursor: "pointer",
                  }}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Audio Status Bar */}
      <div
        style={{
          height: "36px",
          padding: "0 14px",
          backgroundColor: "rgba(0, 0, 0, 0.3)",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "11px",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setShowPreferences(!showPreferences)}
          style={{
            background: "none",
            border: "none",
            color: showPreferences ? "#c4b5fd" : "#94a3b8",
            cursor: "pointer",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <span>⚙ Settings</span>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Audio levels */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }} title="Interviewer sound level">
            <span style={{ color: "#64748b", fontSize: "10px" }}>TAB</span>
            <div
              style={{
                width: "48px",
                height: "5px",
                backgroundColor: "rgba(255, 255, 255, 0.12)",
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, Math.round(level * 400))}%`,
                  backgroundColor: "#22c55e",
                  transition: "width 0.1s ease",
                }}
              />
            </div>
          </div>

          {mic === "on" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }} title="Your microphone level">
              <span style={{ color: "#64748b", fontSize: "10px" }}>MIC</span>
              <div
                style={{
                  width: "40px",
                  height: "5px",
                  backgroundColor: "rgba(255, 255, 255, 0.12)",
                  borderRadius: "999px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round(micLevel * 400))}%`,
                    backgroundColor: "#7b47f3",
                    transition: "width 0.1s ease",
                  }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onEnd}
            style={{
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              color: "#f87171",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            End
          </button>
        </div>
      </div>
    </div>
  );
}
