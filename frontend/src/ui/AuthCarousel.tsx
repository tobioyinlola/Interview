import { useEffect, useRef, useState } from "react";

const ROTATE_MS = 6000;

interface Slide {
  id: string;
  title: string;
  text: string;
  art: React.ReactNode;
}

function Tag() {
  return (
    <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/80">
      Example
    </span>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-surface p-4 text-left text-ink shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

const Cite = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-dark">
    {children}
  </span>
);

/** The three pictures are drawings of the product, not data: each says Example. */
const SLIDES: Slide[] = [
  {
    id: "company",
    title: "Know the company before they ask",
    text: "Add the company you are interviewing with. We research what they do and how, and cite every fact.",
    art: (
      <Card className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Northwind Payments</p>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] text-green-800">
            Brief ready
          </span>
        </div>
        <ul className="space-y-2 text-xs leading-relaxed">
          <li>
            <b>What they do:</b> payment software for independent cafés
            <Cite>site</Cite>
          </li>
          <li>
            <b>Who for:</b> owner-run shops with 1 to 5 locations
            <Cite>blog</Cite>
          </li>
          <li>
            <b>Recent:</b> launched self-serve onboarding in 2025
            <Cite>news</Cite>
          </li>
        </ul>
      </Card>
    ),
  },
  {
    id: "answers",
    title: "A strong answer, the moment they ask",
    text: "The question appears as it is spoken, then an answer built from your CV and what the company does.",
    art: (
      <div className="w-full max-w-sm space-y-3">
        <Card className="!p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Question
          </p>
          <p className="mt-1 text-sm">
            Tell me about a time you led a launch under pressure.
          </p>
        </Card>
        <Card className="!p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-accent-dark">
            Answer
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            At Acme I led a launch against a hard date. I cut scope to what
            mattered most, ran daily check-ins, and we shipped on time with
            onboarding 30% faster.
          </p>
        </Card>
      </div>
    ),
  },
  {
    id: "review",
    title: "Review, score and improve",
    text: "Read the transcript, see how each answer scored, and find the gaps in your CV before the real day.",
    art: (
      <Card className="w-full max-w-sm space-y-3">
        <p className="text-sm font-semibold">Strong structure. Add a number.</p>
        {[
          ["Structure", 82],
          ["Specificity", 64],
          ["Impact", 58],
          ["Relevance", 88],
        ].map(([label, v]) => (
          <div key={label as string}>
            <div className="flex justify-between text-[11px] text-muted">
              <span>{label}</span>
              <span>{v}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-line">
              <div
                className="h-1.5 rounded-full bg-accent"
                style={{ width: `${v}%` }}
              />
            </div>
          </div>
        ))}
      </Card>
    ),
  },
];

/** The showcase beside the sign-in and sign-up forms: three slides that turn by themselves. It
 *  stops while the pointer or keyboard is on it, has a pause button and previous/next/dot controls,
 *  and does not move at all for people who ask their device for less motion. */
export function AuthCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false); // chosen with the button
  const [hovering, setHovering] = useState(false);
  const reduced = useRef(
    typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const running = !paused && !hovering && !reduced.current;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(
      () => setIndex((i) => (i + 1) % SLIDES.length),
      ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [running, index]);

  const go = (i: number) => setIndex((i + SLIDES.length) % SLIDES.length);
  const slide = SLIDES[index];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What InterviewMeet does"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      className="flex h-full flex-col justify-between text-surface"
    >
      <div className="flex items-center justify-between">
        <Tag />
        {!reduced.current && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Play the slideshow" : "Pause the slideshow"}
            className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>

      <div
        role="group"
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${SLIDES.length}`}
        aria-live={running ? "off" : "polite"}
        className="flex flex-1 flex-col items-center justify-center gap-8 py-8"
      >
        <div
          key={slide.id}
          className="flex w-full justify-center motion-safe:animate-[slide-in_.4s_ease-out]"
        >
          {slide.art}
        </div>
        <div className="max-w-sm text-center">
          <h2 className="text-2xl font-semibold leading-snug">{slide.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            {slide.text}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={() => go(index - 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div className="flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Show slide ${i + 1}: ${s.title}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
              className={`h-2 rounded-full transition-all ${
                i === index
                  ? "w-6 bg-white"
                  : "w-2 bg-white/40 hover:bg-white/70"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next slide"
          onClick={() => go(index + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </section>
  );
}
