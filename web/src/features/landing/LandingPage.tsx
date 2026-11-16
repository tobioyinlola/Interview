import { Link } from "react-router-dom";

import { Wordmark } from "./Logo";
import { Cite, HeroDevice, PhoneMock, Waveform, Window } from "./Mockups";

const FEATURES = [
  {
    n: "01",
    title: "Company research",
    body: "Add a company and a job link. A cited brief is ready before you practise: every fact shows its source, and anything without one is dropped.",
  },
  {
    n: "02",
    title: "Live answer outlines",
    body: "When your partner asks a question on Google Meet, an outline streams in seconds: opener, points, close.",
  },
  {
    n: "03",
    title: "Grounded in your notes",
    body: "Outlines use only your notes and the brief. A check flags any number or name that is in neither.",
  },
  {
    n: "04",
    title: "Live captions",
    body: "Your partner's words are captioned from the shared Meet tab. Add your microphone to capture your own answers too.",
  },
  {
    n: "05",
    title: "Scored review",
    body: "After the call, each answer is scored on structure, specificity, impact, relevance and pace, with the exact fixes.",
  },
  {
    n: "06",
    title: "Gap finder",
    body: "See which questions your notes could not answer, so you know what to add before the real interview.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Prepare",
    body: "Write your notes and add the company and role you are interviewing for. We build the brief.",
  },
  {
    n: "02",
    title: "Practise on Meet",
    body: "Join a Google Meet with a friend, share the Meet tab with audio, and answer their questions as outlines appear.",
  },
  {
    n: "03",
    title: "Review",
    body: "Read the transcript, the scores and the fixes, then run it again.",
  },
];

const PRINCIPLES = [
  {
    big: "0",
    label:
      "audio recordings stored. Audio is relayed, transcribed and discarded.",
  },
  {
    big: "100%",
    label: "of brief facts cite a source. Uncited facts are dropped.",
  },
  {
    big: "1",
    label:
      "rule: your partner knows the assistant is on, and you confirm it each session.",
  },
];

function Heading({ eyebrow, a, b }: { eyebrow: string; a: string; b: string }) {
  return (
    <div className="text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
        {a} <em className="text-accent">{b}</em>
      </h2>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="px-4 pt-4 sm:px-6">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-5xl items-center justify-between py-3"
        >
          <Link to="/" aria-label="InterviewMeet home">
            <Wordmark collapseOnTiny />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-ink">
              Features
            </a>
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#principles" className="hover:text-ink">
              Principles
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="px-3 py-2 text-sm font-medium hover:text-accent-dark"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/90"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent-dark">
            ✦ Practice on Google Meet
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Ace every interview,{" "}
            <em className="text-accent">answer with confidence</em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            Rehearse on a real Meet call with a friend. InterviewMeet listens to
            the questions and drafts answer outlines from your own notes and a
            cited company brief, then scores the session so you walk in calm,
            rehearsed and ready.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="w-full rounded-xl bg-ink px-7 py-3.5 font-medium text-surface shadow-card hover:bg-ink/90 sm:w-auto"
            >
              Get started
            </Link>
            <a
              href="#how"
              className="w-full rounded-xl border border-line bg-surface px-7 py-3.5 font-medium shadow-card hover:border-accent sm:w-auto"
            >
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm text-muted">
            Sign up with Google or just your email. For practice with a partner
            who knows it is on.
          </p>
          <div className="mt-14 grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <HeroDevice />
            <div className="hidden lg:block">
              <PhoneMock />
            </div>
          </div>
        </section>

        {/* Principles in place of logos and statistics */}
        <section
          id="principles"
          className="border-y border-line bg-canvas py-16"
        >
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <p className="text-center font-mono text-xs uppercase tracking-[0.2em] text-muted">
              Built around
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <div
                  key={p.big}
                  className="rounded-2xl bg-surface p-6 text-center shadow-card"
                >
                  <div className="text-4xl font-semibold tracking-tight">
                    {p.big}
                  </div>
                  <p className="mt-2 text-sm text-muted">{p.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <Heading
            eyebrow="Features"
            a="Everything you need,"
            b="nothing you don't."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.n}
                className="rounded-2xl bg-surface p-6 shadow-card"
              >
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
                  Feature {f.n}
                </p>
                <p
                  aria-hidden="true"
                  className="mt-3 text-6xl font-semibold text-line"
                >
                  {f.n}
                </p>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <Heading
            eyebrow="How it works"
            a="Three steps,"
            b="one practice loop."
          />
          <ol className="mt-12 space-y-8">
            {STEPS.map((s, i) => (
              <li key={s.n} className="relative flex gap-5">
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[19px] top-11 h-[calc(100%-1rem)] w-px bg-line"
                  />
                )}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-surface">
                  {s.n}
                </span>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    Step {s.n}
                  </p>
                  <h3 className="text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1 text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Product */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <Heading
            eyebrow="The product"
            a="A studio for your"
            b="best answers."
          />
          <div className="mt-12 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Window title="Company brief">
              <p className="text-lg font-semibold">What they do</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  A statement drawn from the company&apos;s own site.
                  <Cite>source 1</Cite>
                </li>
                <li>
                  Something from the job posting you linked.
                  <Cite>source 2</Cite>
                </li>
                <li className="text-muted">Recent news: Not found</li>
              </ul>
              <p className="mt-4 text-xs text-muted">
                Empty sections say so. Nothing is filled in without a source.
              </p>
            </Window>
            <div className="grid gap-4">
              <Window title="Live session">
                <p className="text-sm font-medium">
                  &ldquo;Why do you want to work here?&rdquo;
                </p>
                <Waveform className="mt-3" />
              </Window>
              <Window title="Review">
                <p className="text-sm font-medium">
                  Overall: strong, with one structural note.
                </p>
                <p className="mt-2 text-xs text-muted">
                  Scores and fixes for every answer, plus the full transcript.
                </p>
              </Window>
            </div>
          </div>
        </section>

        {/* Practice, openly */}
        <section className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
          <Heading
            eyebrow="Practice, openly"
            a="Made for rehearsal,"
            b="not for hiding."
          />
          <p className="mt-6 text-muted">
            InterviewMeet is for practising with a friend who knows the
            assistant is on, and you confirm that before every session. There is
            no feature to hide it, and none will be added. Use it to prepare,
            then walk into the real interview on your own words.
          </p>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="rounded-[28px] bg-ink px-6 py-16 text-center text-surface shadow-lift sm:px-12">
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Your next interview{" "}
              <em className="text-[#A98BFF]">starts here.</em>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-surface/80">
              Create your account, add your notes and a company, and run your
              first practice session.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/signup"
                className="w-full rounded-xl bg-surface px-7 py-3.5 font-medium text-ink hover:bg-canvas sm:w-auto"
              >
                Get started →
              </Link>
              <a
                href="#features"
                className="w-full rounded-xl border border-surface/40 px-7 py-3.5 font-medium text-surface hover:border-surface sm:w-auto"
              >
                See features
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-surface">
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:grid-cols-[1.4fr_1fr_1fr] sm:px-6">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm text-muted">
              A quiet studio for interview practice, built around consent and
              your own words.
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Product
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <Link to="/signup">Create account</Link>
              </li>
              <li>
                <Link to="/login">Sign in</Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted">
              Legal
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <Link to="/terms">Terms</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mx-auto max-w-5xl border-t border-line px-4 py-6 text-xs text-muted sm:px-6">
          © 2026 InterviewMeet
        </div>
      </footer>
    </div>
  );
}
