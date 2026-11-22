import type { AAProfile, AAProfileIn } from "../../../api/types";

/** Everything the setup flow edits, held as one draft so every step sees the same picture. */
export interface Draft {
  roles: string[];
  rolesReq: boolean;
  locations: string[];
  locationsReq: boolean;
  arrangement: string[];
  arrangementReq: boolean;
  seniority: string[];
  seniorityReq: boolean;
  contract: string[];
  contractReq: boolean;
  industries: string[];
  industriesReq: boolean;
  salaryFloor: string;
  currency: string;
  period: string;
  salaryReq: boolean;
  need: "" | "needed" | "not_needed";
  sponsorReq: boolean;
  timezone: string;
  anyHours: boolean;
  start: number;
  end: number;
  cap: number;
  outreachCap: number;
  channels: { form: boolean; email: boolean; outreach: boolean };
}

type Item = { value: string; required: boolean };

const items = (list: unknown): { values: string[]; required: boolean } => {
  const rows = (list as Item[] | undefined) ?? [];
  return {
    values: rows.map((i) => i.value),
    required: rows.some((i) => i.required),
  };
};
const toItems = (values: string[], required: boolean): Item[] =>
  values.map((value) => ({ value, required }));

export const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function fromProfile(p: AAProfile): Draft {
  const c = p.criteria as Record<string, unknown>;
  const roles = items(c.roles);
  const locs = items(c.locations);
  const arr = items(c.arrangement);
  const sen = items(c.seniority);
  const con = items(c.contract);
  const ind = items(c.industries);
  const sal = c.salary as
    | { floor: number; currency: string; period: string; required: boolean }
    | undefined;
  const spon = c.sponsorship as { need: string; required: boolean } | undefined;
  const hours = p.active_hours as Record<string, number>;
  const hasHours = hours.start !== undefined && hours.end !== undefined;
  return {
    roles: roles.values,
    rolesReq: p.version === 0 ? true : roles.required,
    locations: locs.values,
    locationsReq: p.version === 0 ? true : locs.required,
    arrangement: arr.values,
    arrangementReq: arr.required,
    seniority: sen.values,
    seniorityReq: sen.required,
    contract: con.values,
    contractReq: con.required,
    industries: ind.values,
    industriesReq: ind.required,
    salaryFloor: sal ? String(sal.floor) : "",
    currency: sal?.currency ?? "USD",
    period: sal?.period ?? "year",
    salaryReq: sal?.required ?? false,
    need: (spon?.need as Draft["need"]) ?? "",
    sponsorReq: spon?.required ?? false,
    timezone:
      p.timezone === "UTC" && p.version === 0 ? browserZone() : p.timezone,
    anyHours: !hasHours,
    start: hasHours ? hours.start : 9,
    end: hasHours ? hours.end : 18,
    cap: p.daily_application_cap,
    outreachCap: p.daily_outreach_cap,
    channels: {
      form: !!p.channels.form,
      email: !!p.channels.email,
      outreach: !!p.channels.outreach,
    },
  };
}

/** The whole profile, ready to save. Sent complete each time, so a step never loses another's work. */
export function toProfileIn(d: Draft): AAProfileIn {
  const criteria: Record<string, unknown> = {
    roles: toItems(d.roles, d.rolesReq),
    locations: toItems(d.locations, d.locationsReq),
    industries: toItems(d.industries, d.industriesReq),
    arrangement: toItems(d.arrangement, d.arrangementReq),
    seniority: toItems(d.seniority, d.seniorityReq),
    contract: toItems(d.contract, d.contractReq),
  };
  if (d.salaryFloor.trim() && Number(d.salaryFloor) > 0)
    criteria.salary = {
      floor: Number(d.salaryFloor),
      currency: d.currency,
      period: d.period,
      required: d.salaryReq,
    };
  if (d.need) criteria.sponsorship = { need: d.need, required: d.sponsorReq };
  return {
    criteria,
    timezone: d.timezone,
    active_hours: d.anyHours ? {} : { start: d.start, end: d.end },
    channels: d.channels,
    daily_application_cap: d.cap,
    daily_outreach_cap: d.outreachCap,
  };
}

export const STEPS = [
  { id: "details", title: "Your details", short: "Details" },
  { id: "role", title: "What you want", short: "Role & place" },
  { id: "preferences", title: "Nice to have", short: "Preferences" },
  { id: "schedule", title: "When to apply", short: "Schedule" },
  { id: "apply", title: "How to apply", short: "Channels" },
  { id: "answers", title: "Your quick answers", short: "Answers" },
  { id: "review", title: "Review and start", short: "Start" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
export const stepIndex = (id: string) => STEPS.findIndex((s) => s.id === id);
export const isStep = (id: string | null): id is StepId =>
  !!id && stepIndex(id) >= 0;

/** What each step needs before Next is allowed. Optional steps have no entry. */
export function stepProblem(
  id: StepId,
  d: Draft,
  ctx: { factsConfirmed: boolean; hasCv: boolean; mailbox: boolean },
): string | null {
  switch (id) {
    case "details":
      if (!ctx.hasCv) return "Upload your CV to continue.";
      return ctx.factsConfirmed
        ? null
        : "Check your details and confirm them to continue.";
    case "role":
      if (d.roles.length === 0) return "Add at least one role.";
      if (d.locations.length === 0)
        return "Add a country or region you can work in.";
      return null;
    case "schedule":
      if (!d.timezone) return "Choose your time zone.";
      if (!d.anyHours && d.start === d.end)
        return "Choose different start and end hours.";
      return null;
    case "apply":
      if (!d.channels.form && !d.channels.email)
        return "Choose at least one way to apply.";
      if ((d.channels.email || d.channels.outreach) && !ctx.mailbox)
        return "Connect your email, or switch off the email options.";
      return null;
    default:
      return null;
  }
}

/** Which steps can be shown as done, for the progress rail. */
export function doneSteps(
  d: Draft,
  ctx: { factsConfirmed: boolean; hasCv: boolean; mailbox: boolean },
  visited: Set<string>,
): Set<StepId> {
  const done = new Set<StepId>();
  for (const s of STEPS) {
    if (s.id === "review") continue;
    const optional = ["preferences", "answers"].includes(s.id);
    if (stepProblem(s.id, d, ctx) === null && (!optional || visited.has(s.id)))
      if (s.id !== "schedule" || visited.has("schedule")) done.add(s.id);
  }
  return done;
}

/** Where to start: the first step that still needs something. */
export function firstOpen(
  d: Draft,
  ctx: { factsConfirmed: boolean; hasCv: boolean; mailbox: boolean },
): StepId {
  for (const s of STEPS)
    if (s.id !== "review" && stepProblem(s.id, d, ctx) !== null) return s.id;
  return "review";
}

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "GHS",
  "ZAR",
  "CAD",
  "AUD",
  "INR",
  "AED",
  "SGD",
];
export const PERIODS = ["hour", "day", "week", "month", "year"];

const COMMON_ZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export function timeZones(current?: string): string[] {
  let all: string[] = [];
  try {
    const f = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    all = f ? f("timeZone") : [];
  } catch {
    all = [];
  }
  const list = all.length ? all : COMMON_ZONES;
  return current && !list.includes(current) ? [current, ...list] : list;
}
