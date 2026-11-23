import { useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { isMobileApp } from "../../app/native";

import { LogoMark } from "../landing/Logo";
import { ApplyArt, CompanyArt, InterviewArt } from "./illustrations";

const DONE = "im-welcome-done";

export const welcomeSeen = (): boolean => {
  try {
    return localStorage.getItem(DONE) === "1";
  } catch {
    return true; // cannot remember: do not trap anyone in a screen they cannot leave for good
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(DONE, "1");
  } catch {
    /* it just shows again next time */
  }
};

const SLIDES = [
  {
    art: <CompanyArt />,
    title: "Know the company first",
    text: "A researched brief on who is interviewing you, with a source for every fact.",
  },
  {
    art: <ApplyArt />,
    title: "Let Auto-Apply do the applying",
    text: "Tell us what you want once. We find roles that fit and keep applying for 30 days.",
  },
  {
    art: <InterviewArt />,
    title: "Walk in prepared",
    text: "Interview invites, quick answers and your history, all in your pocket.",
  },
];

/** The first thing a new install shows: three short slides, then Get started. Phone app only. */
export function Welcome() {
  return isMobileApp() ? <WelcomeSlides /> : <Navigate to="/" replace />;
}

function WelcomeSlides() {
  const navigate = useNavigate();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const go = (i: number) => {
    const el = track.current;
    setIndex(i);
    el?.scrollTo?.({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const leave = (to: string) => {
    markSeen();
    navigate(to, { replace: true });
  };

  return (
    <main className="flex min-h-screen flex-col bg-canvas [min-height:100dvh]">
      <h1 className="sr-only">Welcome to InterviewMeet</h1>
      <header className="flex items-center justify-between px-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <LogoMark className="h-9 w-9" />
        <button
          type="button"
          onClick={() => leave("/login")}
          className="min-h-[44px] px-2 text-sm font-medium text-muted"
        >
          Skip
        </button>
      </header>

      <div
        ref={track}
        role="group"
        aria-roledescription="carousel"
        aria-label="What InterviewMeet does"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth)
            setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map((s, i) => (
          <section
            key={s.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}`}
            className="flex w-full shrink-0 snap-center flex-col justify-center gap-8 px-8"
          >
            {s.art}
            <div className="text-center">
              <h2 className="text-3xl font-semibold leading-tight tracking-tight">
                {s.title}
              </h2>
              <p className="mx-auto mt-3 max-w-xs text-lg text-muted">
                {s.text}
              </p>
            </div>
          </section>
        ))}
      </div>

      <footer className="space-y-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex justify-center gap-2" aria-hidden="true">
          {SLIDES.map((s, i) => (
            <span
              key={s.title}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === index ? "w-7 bg-accent" : "w-2 bg-accent/25"
              }`}
            />
          ))}
        </div>
        {last ? (
          <>
            <button
              type="button"
              onClick={() => leave("/signup")}
              className="flex min-h-[56px] w-full items-center justify-center rounded-full bg-gradient-to-br from-ink to-accent-dark text-lg font-semibold text-surface shadow-lift active:scale-[0.98]"
            >
              Get started
            </button>
            <Link
              to="/login"
              onClick={markSeen}
              className="flex min-h-[44px] items-center justify-center text-sm font-medium text-accent-dark"
            >
              I already have an account
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="flex min-h-[56px] w-full items-center justify-center rounded-full bg-ink text-lg font-semibold text-surface shadow-card active:scale-[0.98]"
          >
            Next
          </button>
        )}
      </footer>
    </main>
  );
}
