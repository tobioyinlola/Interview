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
        call and transcribes it, and get their agreement. You agree to this
        once, with the box you tick when you sign up, and the app records when.
        It does not ask again.
      </p>
      <h2 className="text-lg font-semibold">Sessions and invites</h2>
      <p>
        Every account gets one free practice session. More sessions will be paid
        for one at a time; payments are not available yet. If three people sign
        up with your invite link and confirm their email, you earn one free
        session, which you redeem yourself and can use whenever you like.
        Inviting yourself, a second address of your own, accounts made on your
        own device, or accounts made only to collect rewards does not count, and
        we may take back rewards earned that way.
      </p>
      <h2 className="text-lg font-semibold">The law</h2>
      <p>
        Rules on recording and transcribing calls differ by country and state.
        You are responsible for following the law where you and your partner
        are.
      </p>
      <h2 className="text-lg font-semibold">Accuracy</h2>
      <p>
        Answers are suggestions. Your own experience in them comes only from
        your CV, company facts only from your company brief, each labelled with
        its source; the rest is general interview advice, and any example marked
        as a sample is illustrative, not your history. They can still be wrong
        or incomplete. Check company facts before you rely on them, and never
        claim experience you do not have.
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
        <li>
          Your email address, target role and the text of your CV. The CV file
          you upload is read and then discarded: only the text we read from it
          is saved.
        </li>
        <li>
          Companies you add, the pages and search results used, and the brief.
        </li>
        <li>
          Text transcripts of your sessions, the outlines shown, scores and
          ratings.
        </li>
        <li>
          The time you agreed that your partner knows the assistant is on, and
          the start time of each session.
        </li>
        <li>
          Counts of audio seconds and tokens used (for limits and cost), never
          content.
        </li>
        <li>
          To stop people inviting themselves, a random device id in a cookie and
          a coarse description of your device (screen size, time zone, language
          and processor count) and your network address, each kept only as a
          scrambled value, not readable back. They are used only to see whether
          an invite came from the inviter&apos;s own device, and are deleted
          with your account.
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
        you agreed to, and delete the session if they ask you to.
      </p>
    </Shell>
  );
}
