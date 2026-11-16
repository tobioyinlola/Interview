import { Link } from "react-router-dom";

import { PublicShell } from "../../ui/PublicShell";

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <PublicShell>
      <main className="page-narrow">
        <p role="note" className="notice-warn">
          Draft. This wording needs review by a lawyer before the app is opened
          to the public.
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="space-y-3 leading-relaxed text-ink/90 [&_h2]:pt-4 [&_h2]:text-ink">
          {children}
        </div>
        <p className="text-sm">
          <Link to="/" className="text-accent-dark underline">
            Back to the app
          </Link>
        </p>
      </main>
    </PublicShell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms of use">
      <h2 className="text-lg font-semibold">Practice only</h2>
      <p>
        InterviewMeet is for practising interviews with a friend, mentor or peer
        who knows the assistant is on. It is not for real interviews, and it has
        no feature to hide the assistant from another person or to avoid
        screen-share, proctoring or detection tools. None will be added.
      </p>
      <h2 className="text-lg font-semibold">Consent</h2>
      <p>
        You must tell your practice partner that the assistant listens to the
        call and transcribes it, and get their agreement before each session.
        The app records that you confirmed this, and the time.
      </p>
      <h2 className="text-lg font-semibold">The law</h2>
      <p>
        Rules on recording and transcribing calls differ by country and state.
        You are responsible for following the law where you and your partner
        are.
      </p>
      <h2 className="text-lg font-semibold">Accuracy</h2>
      <p>
        Outlines are suggestions built only from your notes and your company
        brief, with the source of each point. They can still be wrong or
        incomplete. Check company facts before you rely on them, and never claim
        experience you do not have.
      </p>
      <h2 className="text-lg font-semibold">Company research</h2>
      <p>
        Research covers companies, not people. It reads only public pages,
        respects robots.txt, and never signs in anywhere. Do not add links to
        personal profiles.
      </p>
    </Shell>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy">
      <h2 className="text-lg font-semibold">What is stored</h2>
      <ul className="list-disc pl-5">
        <li>Your email address, your notes and target role.</li>
        <li>
          Companies you add, the pages and search results used, and the brief.
        </li>
        <li>
          Text transcripts of your sessions, the outlines shown, scores and
          ratings.
        </li>
        <li>
          The time you confirmed your partner&apos;s consent for each session.
        </li>
        <li>
          Counts of audio seconds and tokens used (for limits and cost), never
          content.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">What is not stored</h2>
      <p>
        Audio. It is relayed for transcription and discarded. Logs hold ids and
        timings only.
      </p>
      <h2 className="text-lg font-semibold">Who else sees it</h2>
      <p>
        Audio and text are sent to OpenAI to transcribe speech, search the web,
        write briefs and outlines, and score answers. Your content is not used
        by this app to train models.
      </p>
      <h2 className="text-lg font-semibold">Deleting your data</h2>
      <p>
        You can delete a session, a company, or your whole account from the app.
        It leaves the app at once and storage within 30 days, as backups age
        out.
      </p>
      <h2 className="text-lg font-semibold">Your partner</h2>
      <p>
        Your partner&apos;s speech is transcribed during the call. Tell them, as
        the consent step says, and delete the session if they ask you to.
      </p>
    </Shell>
  );
}
