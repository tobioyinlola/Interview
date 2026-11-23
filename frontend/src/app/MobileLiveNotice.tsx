import { Link } from "react-router-dom";

/** Live interviews listen to the interviewer's call, which a phone app cannot do. */
export function MobileLiveNotice() {
  return (
    <main className="page-narrow">
      <h1 className="text-2xl font-semibold tracking-tight">
        Live interviews run on your computer
      </h1>
      <p className="text-muted">
        InterviewMeet listens to the call to draft your answers. A phone
        can&apos;t capture another app&apos;s audio, so start the interview in
        the InterviewMeet desktop app or in Chrome or Edge on a computer.
      </p>
      <p>
        Here on your phone you can set up Auto-Apply, approve applications,
        research companies, review past interviews and manage your CV.
      </p>
      <Link to="/dashboard" className="btn-primary inline-block">
        Back to home
      </Link>
    </main>
  );
}
