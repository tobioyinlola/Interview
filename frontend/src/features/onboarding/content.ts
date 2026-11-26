import type { components } from "../../api/schema";

type Answers = components["schemas"]["OnboardingAnswers"];
export type Goal = NonNullable<Answers["goal"]>;
export type Level = NonNullable<Answers["level"]>;
export type Timeline = NonNullable<Answers["timeline"]>;
export type Focus = NonNullable<Answers["focus"]>[number];
export type Help = NonNullable<Answers["help"]>[number];
export type Search = NonNullable<Answers["search"]>;
export type Arrangement = NonNullable<Answers["arrangement"]>[number];

export interface Choice {
  emoji: string;
  label: string;
  hint: string;
}

/** The questions and their answers. Each table must cover every value the API accepts: a missing or
 *  extra answer is a compile error, because the types come from the API's own schema. */
export const GOALS = {
  new_job: {
    emoji: "💼",
    label: "A new job",
    hint: "I'm interviewing with companies right now",
  },
  promotion: {
    emoji: "🚀",
    label: "A promotion or internal move",
    hint: "I'm going for a bigger role where I work",
  },
  career_change: {
    emoji: "🔄",
    label: "A career change",
    hint: "I'm moving into a new field or function",
  },
  practice: {
    emoji: "🎯",
    label: "Just getting ready",
    hint: "No date yet. I want to build the habit",
  },
} satisfies Record<Goal, Choice>;

export const LEVELS = {
  entry: {
    emoji: "🌱",
    label: "Early career",
    hint: "Student, graduate, or up to 2 years",
  },
  mid: { emoji: "🌿", label: "Mid-level", hint: "About 3 to 5 years" },
  senior: { emoji: "🌳", label: "Senior", hint: "About 6 to 10 years" },
  lead: {
    emoji: "🏔️",
    label: "Lead or executive",
    hint: "10+ years, or managing a team",
  },
} satisfies Record<Level, Choice>;

export const TIMELINES = {
  this_week: {
    emoji: "⚡",
    label: "This week",
    hint: "Let's be quick and focused",
  },
  few_weeks: {
    emoji: "📅",
    label: "In the next few weeks",
    hint: "Enough time for a few mock interviews",
  },
  few_months: {
    emoji: "🗓️",
    label: "In a month or two",
    hint: "Plenty of time to prepare properly",
  },
  not_scheduled: {
    emoji: "🕊️",
    label: "Not scheduled yet",
    hint: "I want to be ready when one comes",
  },
} satisfies Record<Timeline, Choice>;

export const FOCUS = {
  structure: {
    emoji: "🧱",
    label: "Structuring my answers",
    hint: "Clear stories with a beginning, a middle and a result",
  },
  results: {
    emoji: "📈",
    label: "Backing claims with results",
    hint: "Numbers and specifics, not vague claims",
  },
  confidence: {
    emoji: "🧘",
    label: "Sounding calm and confident",
    hint: "Pace, filler words and nerves",
  },
  technical: {
    emoji: "🛠️",
    label: "Technical questions",
    hint: "Explaining ideas and trade-offs clearly",
  },
  company: {
    emoji: "🏢",
    label: "Company questions",
    hint: "“Why us?” and what I know about them",
  },
  curveballs: {
    emoji: "🌀",
    label: "Curveball questions",
    hint: "Failures, conflict and tough questions",
  },
} satisfies Record<Focus, Choice>;

export const MAX_FOCUS = 3;

/** The job-search side: what else they want help with. */
export const HELPS = {
  interviews: {
    emoji: "🎤",
    label: "Practise interviews",
    hint: "Mock interviews with answers and feedback",
  },
  auto_apply: {
    emoji: "📨",
    label: "Find and apply to jobs for me",
    hint: "Auto-Apply searches daily and prepares each application",
  },
  startups: {
    emoji: "🚀",
    label: "Reach out to startups",
    hint: "Short notes to founders and hiring contacts",
  },
} satisfies Record<Help, Choice>;

export const SEARCHES = {
  now: {
    emoji: "🔥",
    label: "Right now",
    hint: "I want to start applying this week",
  },
  soon: {
    emoji: "📆",
    label: "In the next month or two",
    hint: "I'm getting ready",
  },
  later: {
    emoji: "🌤️",
    label: "Later, just exploring",
    hint: "Show me what's out there",
  },
} satisfies Record<Search, Choice>;

export const ARRANGEMENTS = {
  remote: {
    emoji: "🏠",
    label: "Remote",
    hint: "Work from anywhere",
  },
  hybrid: {
    emoji: "🔀",
    label: "Hybrid",
    hint: "Some days in an office",
  },
  onsite: {
    emoji: "🏢",
    label: "On-site",
    hint: "In the office",
  },
} satisfies Record<Arrangement, Choice>;

export interface StepInfo {
  title: string;
  /** Why we ask: shown under the question so the answer never feels like a form for its own sake. */
  why: string;
}

export const STEPS: StepInfo[] = [
  {
    title: "What are you preparing for?",
    why: "So your interviews fit what's at stake.",
  },
  {
    title: "Tell us about your role",
    why: "Your target role shapes the company briefs and the questions we expect.",
  },
  {
    title: "When is your interview?",
    why: "So we can suggest a sensible plan.",
  },
  {
    title: "What do you want to get better at?",
    why: `Pick up to ${MAX_FOCUS}. We'll keep them in view on your dashboard.`,
  },
  {
    title: "What else can we help with?",
    why: "Pick everything that applies. You can change this any time.",
  },
  {
    title: "How soon are you looking for a job?",
    why: "So Auto-Apply knows how soon to start.",
  },
  {
    title: "How do you want to work?",
    why: "Auto-Apply only looks at jobs that fit. Pick all that suit you; you can refine this later.",
  },
];

/** Where the job-search questions sit in STEPS. */
export const HELP_STEP = 4;
export const JOB_STEPS = [5, 6];

/** The steps this person sees: the interview questions and the help question for everyone, then the
 *  two job-search questions only for someone who wants Auto-Apply or startup outreach. */
export const flowFor = (help: Help[]): number[] => [
  0,
  1,
  2,
  3,
  HELP_STEP,
  ...(help.includes("auto_apply") || help.includes("startups")
    ? JOB_STEPS
    : []),
];

/** A short plan to match how soon the interview is. */
export const PLAN: Record<Timeline, string> = {
  this_week:
    "Your interview is close, so let's move fast: upload your CV, add the company, and run a mock interview today.",
  few_weeks:
    "You have a few weeks: aim for two or three mock interviews, each with a different friend.",
  few_months:
    "You have plenty of time: get your CV and company briefs right first, then run a mock interview once a week.",
  not_scheduled:
    "No rush: set up your CV now, so you're ready the moment an interview lands.",
};

export const entries = <K extends string>(table: Record<K, Choice>) =>
  (Object.keys(table) as K[]).map((value) => ({ value, ...table[value] }));
