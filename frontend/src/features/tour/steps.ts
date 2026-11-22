/** The first-time tour. A step with a `target` points at the real item on screen (found by its
 *  data-tour attribute); a step without one, or whose item is not on screen (the menu is a drawer on
 *  a phone), is shown in the middle of the screen instead, with the same words. */
export interface TourStep {
  id: string;
  target?: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to InterviewMeet",
    body: "Here is a one-minute tour of where things are. You can skip it now and take it again any time from your account menu.",
  },
  {
    id: "search",
    target: "search",
    title: "Search everything",
    body: "Find any page, company or past session. Press / to jump here from anywhere.",
  },
  {
    id: "cv",
    target: "nav-notes",
    title: "1. Upload your CV",
    body: "Your own stories and numbers in an answer come only from your CV. Set your target role here too.",
  },
  {
    id: "companies",
    target: "nav-companies",
    title: "2. Add a company",
    body: "We research the company and build a brief where every fact names its source. Answers use it to link your experience to what the company does.",
  },
  {
    id: "practice",
    target: "nav-session-new",
    title: "3. Run a mock interview",
    body: "Start a session, join a Google Meet with a friend who knows the assistant is on, and share the Meet tab with its audio.",
  },
  {
    id: "panel",
    title: "The live panel",
    body: "Each question appears as your partner says it, then the answer. The answer stays put until a genuinely new question comes, or you press Done, next question. Talk that is not a question changes nothing.",
  },
  {
    id: "review",
    target: "nav-sessions",
    title: "4. Review your sessions",
    body: "After a session, read the transcript, score your answers and see where your CV has gaps.",
  },
  {
    id: "invite",
    target: "nav-referrals",
    title: "Free sessions",
    body: "Your first session is free. Invite three friends who sign up and you earn another.",
  },
  {
    id: "account",
    target: "profile",
    title: "Your account",
    body: "Settings, Help and this tour are in your account menu. Good luck with the interviews.",
  },
];
