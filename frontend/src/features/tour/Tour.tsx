import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TourStep } from "./steps";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;

/** The on-screen box of a tour target, or null if it is not there or not visible. */
function boxOf(target: string | undefined): Box | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null; // hidden, e.g. the menu on a phone
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Where the card goes: beside a target in the sidebar, below one in the top bar, and never off
 *  screen. With no target it sits in the middle. */
function place(box: Box | null, card: { w: number; h: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(n, Math.max(lo, hi)));
  if (!box)
    return {
      top: Math.max(16, (vh - card.h) / 2),
      left: Math.max(16, (vw - card.w) / 2),
    };
  if (box.left + box.width < vw * 0.4 && vw >= 700) {
    // a sidebar item: put the card to its right
    return {
      top: clamp(box.top - 8, 16, vh - card.h - 16),
      left: box.left + box.width + PAD + GAP,
    };
  }
  const below = box.top + box.height + PAD + GAP;
  const top =
    below + card.h <= vh - 16
      ? below
      : Math.max(16, box.top - PAD - GAP - card.h);
  return {
    top,
    left: clamp(box.left + box.width - card.w, 16, vw - card.w - 16),
  };
}

/** The tour: dims the page, rings the real item a step is about, and shows a card with Back, Next
 *  and Skip. Escape skips. Focus stays inside the card. */
export function Tour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  /** `finished` is true when the last step was completed, false when it was skipped. */
  onClose: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Bring the target into view, then follow it as the page moves or resizes.
  useLayoutEffect(() => {
    const measure = () => {
      const b = boxOf(step.target);
      setBox(b);
      const card = cardRef.current;
      setPos(
        place(b, { w: card?.offsetWidth ?? 340, h: card?.offsetHeight ?? 200 }),
      );
    };
    if (step.target)
      document
        .querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => nextRef.current?.focus(), [index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(false);
    } else if (e.key === "Tab") {
      const focusable =
        cardRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* A click anywhere outside the card does nothing: the tour is a guided path, not a trap. */}
      {box ? (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          className="pointer-events-none fixed rounded-xl"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            // a white ring with a purple edge reads on the dark sidebar and the light top bar alike
            boxShadow:
              "0 0 0 2px #FFFFFF, 0 0 0 4px #7B47F3, 0 0 0 9999px rgba(20, 18, 40, 0.62)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-ink/60" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed w-[min(360px,calc(100vw-2rem))] rounded-2xl bg-surface p-5 shadow-lift"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="text-xs font-medium text-muted">
          Step {index + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-2 text-sm leading-relaxed text-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => onClose(false)}
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setIndex(index - 1)}
              >
                Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              className="btn-primary btn-sm"
              onClick={() => (last ? onClose(true) : setIndex(index + 1))}
            >
              {last ? "Done" : index === 0 ? "Start" : "Next"}
            </button>
          </div>
        </div>
        <div aria-hidden="true" className="mt-4 flex justify-center gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-accent" : "bg-line-strong"}`}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
