import { Link } from "react-router-dom";

import { useTour } from "../tour/TourProvider";

const QUICK_START: { to: string; title: string; text: string }[] = [
  {
    to: "/notes",
    title: "Upload your CV",
    text: "A PDF, Word (.docx) or text file. Set your target role too. Your own stories and numbers in an answer come only from your CV.",
  },
  {
    to: "/companies",
    title: "Add the company",
    text: "Give a name, website and job link. We build a brief where every fact cites its source, and answers use it to link your experience to what the company does.",
  },
  {
    to: "/session/new",
    title: "Start a practice session",
    text: "Pick the company, then join a Google Meet with a friend who knows the assistant is on.",
  },
  {
    to: "/session/new",
    title: "Share the Meet tab with audio",
    text: "On the live page press Share Meet tab, choose the Meet tab, and tick Also share tab audio. Keep that tab open.",
  },
  {
    to: "/sessions",
    title: "Review afterwards",
    text: "Read the transcript, score your answers and see where your CV has gaps. Then run it again.",
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "The answer on the panel did not change. Is it broken?",
    a: "No. An answer stays exactly as it is until your partner asks a genuinely new question, or until you press Done, next question. Remarks that are not questions change nothing. If you want a different take on the same question, press Regenerate.",
  },
  {
    q: "The question on the panel is wrong or incomplete.",
    a: "Transcription depends on the audio. Use headphones so your partner's voice is not picked up twice, share the Meet tab with Also share tab audio ticked, and ask your partner to speak clearly. If it still misses, type the question in the box under the panel.",
  },
  {
    q: "Nothing is being transcribed.",
    a: "Check the green level bar on the live page moves when your partner speaks. If it does not, stop sharing and share the Meet tab again with Also share tab audio ticked. Use Chrome or Edge on a computer.",
  },
  {
    q: "Why does the answer sometimes say there is no matching story in my CV?",
    a: "Your own experience is taken only from your CV, so nothing is invented about you. When it has nothing that fits, you still get a full model answer built on a clearly marked example, to show the shape of a good answer. Swap in your own real experience.",
  },
  {
    q: "How do free sessions work?",
    a: "Your first session is free. After that each session will be paid for one at a time; payments are not available yet. Invite three friends who sign up with your link and confirm their email and you earn one free session, which you redeem on the Invite friends page.",
  },
  {
    q: "Why did a friend's sign-up not count?",
    a: "Inviting yourself, a second address of your own, or an account made on your own device does not count. If you share a computer with a friend, that can look the same.",
  },
  {
    q: "Can I use it in a real interview?",
    a: "No. InterviewMeet is for practice with a partner who knows the assistant is listening. You agreed to that when you signed up.",
  },
  {
    q: "What do you keep?",
    a: (
      <>
        Audio is relayed for transcription and discarded; only text is saved.
        You can delete a session, a company or your whole account at any time.
        See the{" "}
        <Link to="/privacy" className="text-accent-dark underline">
          privacy notice
        </Link>
        .
      </>
    ),
  },
];

/** Where to find things, how the live panel behaves, and answers to common questions. */
export function HelpPage() {
  const tour = useTour();
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Help</h1>
      <p className="text-sm text-muted">
        How to get started, how the live panel works, and answers to common
        questions.
      </p>
      <div>
        <button type="button" className="btn-primary" onClick={tour.start}>
          Take the tour
        </button>
      </div>

      <section aria-labelledby="qs-h" className="card space-y-3">
        <h2 id="qs-h" className="text-lg font-semibold">
          Quick start
        </h2>
        <ol className="space-y-3">
          {QUICK_START.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-dark"
              >
                {i + 1}
              </span>
              <div>
                <Link
                  to={s.to}
                  className="font-medium text-accent-dark underline"
                >
                  {s.title}
                </Link>
                <p className="text-sm text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="panel-h" className="card space-y-2">
        <h2 id="panel-h" className="text-lg font-semibold">
          How the live panel works
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            The question appears word by word as your partner says it, then the
            answer follows.
          </li>
          <li>
            The answer is written at your level, ties in what the company does
            and your relevant experience, and uses the language of your role.
          </li>
          <li>
            Once an answer is up it stays. It changes only for a genuinely new
            question, or when you press <strong>Done, next question</strong>.
          </li>
          <li>
            Remarks that are not questions change nothing, on the answer or on
            the question.
          </li>
          <li>
            <strong>Answer-first</strong> blurs each answer until you click it,
            so you can try before you peek. <strong>Regenerate</strong> asks
            again for the same question.
          </li>
          <li>
            The panel can float over your Meet window: press{" "}
            <strong>Float the answer panel</strong> in Chrome or Edge.
          </li>
        </ul>
      </section>

      <section aria-labelledby="faq-h" className="space-y-2">
        <h2 id="faq-h" className="text-lg font-semibold">
          Common questions
        </h2>
        <div className="list-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                {f.q}
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
