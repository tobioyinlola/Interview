/** Illustrations of the product. They are drawings, not data: every one says "Example". */

const BARS = [
  38, 62, 30, 80, 52, 90, 44, 70, 34, 84, 48, 66, 28, 76, 56, 40, 72, 32, 60,
  46,
];

export function Waveform({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex h-10 items-center gap-[3px] ${className}`}
      aria-hidden="true"
    >
      {BARS.map((h, i) => (
        <span
          key={i}
          className="wave-bar w-[3px] rounded-full bg-ink/70"
          style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function ExampleTag() {
  return (
    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-dark">
      Example
    </span>
  );
}

export function Window({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-2xl border border-line bg-surface shadow-card ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B7A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#B58CFF]" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <span className="mx-auto font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          {title}
        </span>
        <ExampleTag />
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/** Wide "device": the live session as it looks while practising. */
export function HeroDevice() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-3xl rounded-[28px] border-[10px] border-ink bg-ink shadow-lift"
    >
      <div className="overflow-hidden rounded-[18px] bg-surface">
        <div className="grid grid-cols-[150px_1fr] max-sm:grid-cols-1">
          <div className="border-r border-line p-4 max-sm:hidden">
            <div className="mb-5 text-sm font-semibold">InterviewMeet</div>
            {["Dashboard", "CV", "Companies", "Practice", "Sessions"].map(
              (x, i) => (
                <div
                  key={x}
                  className={`mb-1 rounded-lg px-3 py-2 text-xs ${
                    i === 3
                      ? "bg-accent-soft font-medium text-accent-dark"
                      : "text-muted"
                  }`}
                >
                  {x}
                </div>
              ),
            )}
          </div>
          <div className="space-y-3 bg-canvas/60 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-accent" /> Listening to
                your partner
              </div>
              <ExampleTag />
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                Partner asked
              </p>
              <p className="mt-1 text-sm font-medium">
                Tell me about a time you led a project under a tight deadline.
              </p>
              <Waveform className="mt-3 h-7" />
            </div>
            <div className="rounded-xl border border-line bg-surface p-4 text-left">
              <p className="font-mono text-[10px] uppercase tracking-wider text-accent-dark">
                Answer
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink/90">
                At Acme I led a migration against a hard launch date. I split
                the work, cut scope to what mattered most, and ran daily
                check-ins with the four engineers on it. We shipped on time, and
                I would repeat the early scope cut.
              </p>
              <p className="mt-2">
                <Cite>note: Acme migration</Cite>
                <Cite>note: led team of 4</Cite>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-dark">
      {children}
    </span>
  );
}

export function PhoneMock() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-[250px] rounded-[34px] border-[9px] border-ink bg-ink shadow-lift"
    >
      <div className="rounded-[25px] bg-canvas p-4">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-ink/80" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Review</span>
          <ExampleTag />
        </div>
        <p className="mt-3 text-sm font-semibold leading-snug">
          Strong structure. Add one number to the result.
        </p>
        {[
          ["Structure", 82],
          ["Specificity", 64],
          ["Impact", 58],
          ["Relevance", 88],
          ["Pace", 76],
        ].map(([k, v]) => (
          <div key={k as string} className="mt-3">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${v}%` }}
              />
            </div>
          </div>
        ))}
        <div className="mt-4 rounded-xl bg-surface p-3 text-[11px] text-muted shadow-card">
          <b className="text-ink">Fix:</b> name the deadline and what you cut.
        </div>
      </div>
    </div>
  );
}
