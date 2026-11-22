import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Loading } from "../../ui/Loading";
import type { AAFacts, AAProfile } from "../../api/types";
import {
  useAAProfile,
  useAnswers,
  useCampaignActions,
  useDashboard,
  useDeleteAnswer,
  useDisclosure,
  useExtractFacts,
  useFacts,
  useMailbox,
  useMailboxActions,
  useSaveAnswer,
  useSaveFacts,
  useSaveProfile,
} from "./api";
import { Fail, Section, day } from "./ui";

type Item = { value: string; required: boolean };
type Criteria = Record<string, unknown>;

const ARRANGEMENTS = ["remote", "hybrid", "onsite"];
const SENIORITY = ["intern", "junior", "mid", "senior", "lead", "executive"];
const CONTRACTS = ["full_time", "part_time", "contract", "internship"];
const PERIODS = ["hour", "day", "week", "month", "year"];
const COMMON_ANSWERS: [string, string][] = [
  ["notice_period", "What is your notice period?"],
  ["work_authorization", "Are you authorised to work in this country?"],
  ["sponsorship", "Do you need visa sponsorship?"],
  ["salary_expectation", "What are your salary expectations?"],
  ["relocation", "Are you willing to relocate?"],
];
const label = (v: string) => v.replace("_", " ");

const lines = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const toItems = (text: string, required: boolean): Item[] =>
  lines(text).map((value) => ({ value, required }));

const fromItems = (items: unknown): { text: string; required: boolean } => {
  const list = (items as Item[] | undefined) ?? [];
  return {
    text: list.map((i) => i.value).join("\n"),
    required: list.some((i) => i.required),
  };
};

/** Pick several of a few fixed choices, and say whether they are a must. */
function Choices({
  legend,
  options,
  value,
  onChange,
  required,
  onRequired,
}: {
  legend: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  required: boolean;
  onRequired: (r: boolean) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, o]
                    : value.filter((x) => x !== o),
                )
              }
            />
            {label(o)}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => onRequired(e.target.checked)}
        />
        This is a must ({legend.toLowerCase()})
      </label>
    </fieldset>
  );
}

// ------------------------------------------------------------------ CV facts

type Job = {
  title: string;
  company: string;
  start: string;
  end: string;
  summary: string;
};
type FactsData = {
  contact: Record<string, string>;
  links: string[];
  skills: string[];
  history: Job[];
  education: string[];
};

function FactsEditor({
  initial,
  fromModel,
  onSaved,
}: {
  initial: FactsData;
  fromModel: boolean;
  onSaved: () => void;
}) {
  const save = useSaveFacts();
  const [d, setD] = useState<FactsData>(initial);
  const contact = (k: string, v: string) =>
    setD({ ...d, contact: { ...d.contact, [k]: v } });
  const job = (i: number, patch: Partial<Job>) =>
    setD({
      ...d,
      history: d.history.map((j, n) => (n === i ? { ...j, ...patch } : j)),
    });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ data: d, verified: true }, { onSuccess: onSaved });
      }}
    >
      {!fromModel && (
        <p className="notice-warn">
          We could only read your contact details automatically. Please add your
          work history and skills yourself.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["name", "Full name"],
            ["email", "Email address"],
            ["phone", "Phone number"],
            ["location", "Where you live"],
          ] as const
        ).map(([k, l]) => (
          <div key={k}>
            <label htmlFor={`f-${k}`} className="text-sm font-medium">
              {l}
            </label>
            <input
              id={`f-${k}`}
              className="input w-full"
              value={d.contact[k] ?? ""}
              onChange={(e) => contact(k, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="f-links" className="text-sm font-medium">
          Links (one per line)
        </label>
        <textarea
          id="f-links"
          rows={2}
          className="input w-full"
          value={d.links.join("\n")}
          onChange={(e) => setD({ ...d, links: lines(e.target.value) })}
        />
      </div>
      <div>
        <label htmlFor="f-skills" className="text-sm font-medium">
          Skills (separated by commas)
        </label>
        <textarea
          id="f-skills"
          rows={2}
          className="input w-full"
          defaultValue={d.skills.join(", ")}
          onBlur={(e) => setD({ ...d, skills: lines(e.target.value) })}
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Work history</legend>
        {d.history.map((j, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {(
                [
                  ["title", "Job title"],
                  ["company", "Employer"],
                  ["start", "Started"],
                  ["end", "Ended"],
                ] as const
              ).map(([k, l]) => (
                <div key={k}>
                  <label htmlFor={`j${i}-${k}`} className="text-xs text-muted">
                    {l} (role {i + 1})
                  </label>
                  <input
                    id={`j${i}-${k}`}
                    className="input w-full"
                    value={j[k]}
                    onChange={(e) => job(i, { [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <label htmlFor={`j${i}-summary`} className="text-xs text-muted">
              What you did (role {i + 1})
            </label>
            <textarea
              id={`j${i}-summary`}
              rows={2}
              className="input w-full"
              value={j.summary}
              onChange={(e) => job(i, { summary: e.target.value })}
            />
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() =>
                setD({ ...d, history: d.history.filter((_, n) => n !== i) })
              }
            >
              Remove role {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setD({
              ...d,
              history: [
                ...d.history,
                { title: "", company: "", start: "", end: "", summary: "" },
              ],
            })
          }
        >
          Add a role
        </button>
      </fieldset>
      <div>
        <label htmlFor="f-edu" className="text-sm font-medium">
          Education and qualifications (one per line)
        </label>
        <textarea
          id="f-edu"
          rows={2}
          className="input w-full"
          value={d.education.join("\n")}
          onChange={(e) => setD({ ...d, education: lines(e.target.value) })}
        />
      </div>
      <Fail error={save.error} />
      <button className="btn-primary" disabled={save.isPending}>
        These details are right
      </button>
    </form>
  );
}

function FactsSection() {
  const facts = useFacts();
  const extract = useExtractFacts();
  const [draft, setDraft] = useState<AAFacts | null>(null);
  if (facts.isPending) return null;
  const saved = facts.data;
  const shown = draft ?? saved;
  return (
    <Section
      id="facts-h"
      title="1. Your details"
      hint="Only details you confirm here are ever sent to an employer, or used to tailor your CV."
    >
      {saved?.verified_at && !draft && (
        <p role="status" className="text-sm">
          ✓ Confirmed {day(saved.verified_at)}.
          {saved.cv_changed &&
            " Your CV has changed since. Read it again to check."}
        </p>
      )}
      {!shown && (
        <p className="text-sm text-muted">
          We will read your CV and show you what we found, so you can correct
          it.
        </p>
      )}
      <Fail error={extract.error} />
      {(!saved || saved.cv_changed || draft === null) && (
        <button
          type="button"
          className="btn-secondary"
          disabled={extract.isPending}
          onClick={() => extract.mutate(undefined, { onSuccess: setDraft })}
        >
          {saved ? "Read my CV again" : "Read my CV"}
        </button>
      )}
      {shown && (
        <FactsEditor
          key={draft ? "draft" : `v${saved?.version}`}
          initial={shown.data as unknown as FactsData}
          fromModel={shown.from_model ?? true}
          onSaved={() => setDraft(null)}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- the search

function SearchForm({ profile }: { profile: AAProfile }) {
  const save = useSaveProfile();
  const c = profile.criteria as Criteria;
  const roles = fromItems(c.roles);
  const locs = fromItems(c.locations);
  const inds = fromItems(c.industries);
  const arr = fromItems(c.arrangement);
  const sen = fromItems(c.seniority);
  const con = fromItems(c.contract);
  const sal = c.salary as
    | { floor: number; currency: string; period: string; required: boolean }
    | undefined;
  const spon = c.sponsorship as { need: string; required: boolean } | undefined;
  const [f, setF] = useState({
    roles: roles.text,
    rolesReq: roles.required,
    locations: locs.text,
    locationsReq: locs.required,
    industries: inds.text,
    industriesReq: inds.required,
    arrangement: arr.text ? arr.text.split("\n") : [],
    arrangementReq: arr.required,
    seniority: sen.text ? sen.text.split("\n") : [],
    seniorityReq: sen.required,
    contract: con.text ? con.text.split("\n") : [],
    contractReq: con.required,
    floor: sal ? String(sal.floor) : "",
    currency: sal?.currency ?? "USD",
    period: sal?.period ?? "year",
    salaryReq: sal?.required ?? false,
    need: spon?.need ?? "",
    sponsorReq: spon?.required ?? false,
    timezone:
      profile.timezone === "UTC" && profile.version === 0
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : profile.timezone,
    start: profile.active_hours.start?.toString() ?? "",
    end: profile.active_hours.end?.toString() ?? "",
    apps: String(profile.daily_application_cap),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF({ ...f, [k]: v });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const criteria: Criteria = {
      roles: toItems(f.roles, f.rolesReq),
      locations: toItems(f.locations, f.locationsReq),
      industries: toItems(f.industries, f.industriesReq),
      arrangement: f.arrangement.map((value) => ({
        value,
        required: f.arrangementReq,
      })),
      seniority: f.seniority.map((value) => ({
        value,
        required: f.seniorityReq,
      })),
      contract: f.contract.map((value) => ({ value, required: f.contractReq })),
    };
    if (f.floor.trim())
      criteria.salary = {
        floor: Number(f.floor),
        currency: f.currency,
        period: f.period,
        required: f.salaryReq,
      };
    if (f.need) criteria.sponsorship = { need: f.need, required: f.sponsorReq };
    save.mutate({
      criteria,
      timezone: f.timezone,
      active_hours:
        f.start !== "" && f.end !== ""
          ? { start: Number(f.start), end: Number(f.end) }
          : {},
      daily_application_cap: Number(f.apps),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="s-roles" className="text-sm font-medium">
          Roles you want (one per line)
        </label>
        <textarea
          id="s-roles"
          rows={2}
          className="input w-full"
          value={f.roles}
          onChange={(e) => set("roles", e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={f.rolesReq}
            onChange={(e) => set("rolesReq", e.target.checked)}
          />
          The role must match
        </label>
      </div>
      <div>
        <label htmlFor="s-locs" className="text-sm font-medium">
          Where you can work: a country or region (one per line)
        </label>
        <textarea
          id="s-locs"
          rows={2}
          className="input w-full"
          value={f.locations}
          onChange={(e) => set("locations", e.target.value)}
        />
        <p className="text-xs text-muted">
          A remote job only counts when the listing says people in your country
          can apply.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={f.locationsReq}
            onChange={(e) => set("locationsReq", e.target.checked)}
          />
          The location must match
        </label>
      </div>
      <Choices
        legend="Work arrangement"
        options={ARRANGEMENTS}
        value={f.arrangement}
        onChange={(v) => set("arrangement", v)}
        required={f.arrangementReq}
        onRequired={(v) => set("arrangementReq", v)}
      />
      <Choices
        legend="Seniority"
        options={SENIORITY}
        value={f.seniority}
        onChange={(v) => set("seniority", v)}
        required={f.seniorityReq}
        onRequired={(v) => set("seniorityReq", v)}
      />
      <Choices
        legend="Contract type"
        options={CONTRACTS}
        value={f.contract}
        onChange={(v) => set("contract", v)}
        required={f.contractReq}
        onRequired={(v) => set("contractReq", v)}
      />
      <div>
        <label htmlFor="s-inds" className="text-sm font-medium">
          Industries (optional, one per line)
        </label>
        <textarea
          id="s-inds"
          rows={1}
          className="input w-full"
          value={f.industries}
          onChange={(e) => set("industries", e.target.value)}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Lowest pay you will take
        </legend>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="s-floor" className="text-xs text-muted">
              Amount
            </label>
            <input
              id="s-floor"
              inputMode="decimal"
              className="input w-32"
              value={f.floor}
              onChange={(e) => set("floor", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="s-cur" className="text-xs text-muted">
              Currency
            </label>
            <input
              id="s-cur"
              maxLength={3}
              className="input w-20 uppercase"
              value={f.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="s-per" className="text-xs text-muted">
              Per
            </label>
            <select
              id="s-per"
              className="input"
              value={f.period}
              onChange={(e) => set("period", e.target.value)}
            >
              {PERIODS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={f.salaryReq}
            onChange={(e) => set("salaryReq", e.target.checked)}
          />
          This is a must. Jobs that do not say what they pay will wait for you.
        </label>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Visa sponsorship</legend>
        <select
          aria-label="Visa sponsorship"
          className="input"
          value={f.need}
          onChange={(e) => set("need", e.target.value)}
        >
          <option value="">Does not matter</option>
          <option value="needed">I need sponsorship</option>
          <option value="not_needed">I do not need sponsorship</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={f.sponsorReq}
            onChange={(e) => set("sponsorReq", e.target.checked)}
          />
          This is a must
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="s-tz" className="text-sm font-medium">
            Your time zone
          </label>
          <input
            id="s-tz"
            className="input w-full"
            value={f.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="s-start" className="text-sm font-medium">
            Send from (hour)
          </label>
          <input
            id="s-start"
            inputMode="numeric"
            className="input w-full"
            placeholder="any"
            value={f.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="s-end" className="text-sm font-medium">
            until (hour)
          </label>
          <input
            id="s-end"
            inputMode="numeric"
            className="input w-full"
            placeholder="any"
            value={f.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </div>
      </div>
      <div>
        <label htmlFor="s-apps" className="text-sm font-medium">
          Most applications per day
        </label>
        <input
          id="s-apps"
          inputMode="numeric"
          className="input w-24"
          value={f.apps}
          onChange={(e) => set("apps", e.target.value)}
        />
      </div>
      <Fail error={save.error} />
      {save.isSuccess && (
        <p role="status" className="text-sm">
          ✓ Saved. Open applications are checked against the new rules.
        </p>
      )}
      <button className="btn-primary" disabled={save.isPending}>
        Save my search
      </button>
    </form>
  );
}

// ------------------------------------------------------------- ways to apply

function ChannelsSection({ profile }: { profile: AAProfile }) {
  const save = useSaveProfile();
  const box = useMailbox();
  const { connect, disconnect } = useMailboxActions();
  // Shown at once and saved in the background, so a tick never waits on the network.
  const [ch, setCh] = useState<Record<string, boolean>>(profile.channels);
  const set = (k: string, v: boolean) => {
    const next = { ...ch, [k]: v };
    setCh(next);
    save.mutate({ channels: next });
  };
  const connected = box.data?.connected;
  return (
    <Section
      id="how-h"
      title="3. How to apply"
      hint="Choose each way separately. You can change this any time."
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!ch.form}
            onChange={(e) => set("form", e.target.checked)}
          />
          Fill in employers' application forms
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!ch.email}
            onChange={(e) => set("email", e.target.checked)}
          />
          Email applications from my own email, when the job says to
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!ch.outreach}
            onChange={(e) => set("outreach", e.target.checked)}
          />
          Send one short note to the hiring contact, when the job lists one
        </label>
      </div>
      <div id="email" className="space-y-2 rounded-xl border border-line p-3">
        <p className="text-sm font-medium">Your email</p>
        {connected ? (
          <p className="text-sm">
            Connected: {box.data?.address}. Applications are sent from here, and
            replies from employers are read here. The messages stay in your
            inbox.
          </p>
        ) : (
          <p className="text-sm text-muted">
            {box.data?.status === "reauth_needed"
              ? "Your email needs to be connected again."
              : "Not connected. It is only needed to email applications or notes, and to notice replies."}
          </p>
        )}
        <div className="flex gap-2">
          {!connected && (
            <button
              type="button"
              className="btn-secondary"
              disabled={connect.isPending || box.data?.can_connect === false}
              onClick={() => connect.mutate()}
            >
              Connect my email
            </button>
          )}
          {connected && (
            <button
              type="button"
              className="btn-secondary"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect my email
            </button>
          )}
        </div>
        {box.data?.can_connect === false && (
          <p className="text-xs text-muted">
            Connecting email is not set up on this server yet.
          </p>
        )}
        <Fail error={connect.error ?? disconnect.error} />
      </div>
      <Fail error={save.error} />
    </Section>
  );
}

// -------------------------------------------------------------------- answers

function AnswersSection() {
  const answers = useAnswers();
  const save = useSaveAnswer();
  const del = useDeleteAnswer();
  const [field, setField] = useState(COMMON_ANSWERS[0][0]);
  const [value, setValue] = useState("");
  const [reusable, setReusable] = useState(true);
  const question = COMMON_ANSWERS.find(([k]) => k === field)?.[1] ?? "";
  return (
    <Section
      id="ans-h"
      title="4. Answers employers ask for"
      hint="Answer once and we will reuse it, but only the answers you approve for reuse. Declarations are always yours to make."
    >
      <ul className="space-y-2">
        {answers.data?.map((a) => (
          <li
            key={a.field}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span>
              <span className="font-medium">{label(a.field)}:</span> {a.value}
              {a.reusable ? "" : " (not reused)"}
            </span>
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => del.mutate(a.field)}
            >
              Remove {label(a.field)}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim())
            save.mutate(
              { field, question, value: value.trim(), reusable },
              { onSuccess: () => setValue("") },
            );
        }}
      >
        <div className="w-full min-w-0 sm:w-auto">
          <label htmlFor="a-field" className="text-xs text-muted">
            Question
          </label>
          <select
            id="a-field"
            className="input w-full sm:w-auto sm:max-w-xs"
            value={field}
            onChange={(e) => setField(e.target.value)}
          >
            {COMMON_ANSWERS.map(([k, q]) => (
              <option key={k} value={k}>
                {q}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="a-value" className="text-xs text-muted">
            Your answer
          </label>
          <input
            id="a-value"
            className="input w-full"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={reusable}
            onChange={(e) => setReusable(e.target.checked)}
          />
          Reuse this answer
        </label>
        <button className="btn-secondary" disabled={save.isPending}>
          Save answer
        </button>
      </form>
      <Fail error={save.error ?? del.error} />
    </Section>
  );
}

// ---------------------------------------------------------------- authorising

function StartSection() {
  const disc = useDisclosure();
  const dash = useDashboard();
  const { enable, pause, resume } = useCampaignActions();
  const [agree, setAgree] = useState(false);
  const navigate = useNavigate();
  if (!disc.data) return null;
  const d = disc.data;
  const state = dash.data?.campaign.state ?? "none";
  const live = state === "active" || state === "paused";
  return (
    <Section
      id="start-h"
      title="5. Review and start"
      hint="Auto-Apply runs for 30 days from the day you start. Pausing does not extend it."
    >
      <div className="space-y-2 text-sm">
        <p className="font-medium">What will be shared with employers</p>
        <ul className="list-disc pl-5">
          {d.shared.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>
          Ways to apply:{" "}
          {Object.entries(d.channels)
            .filter(([, on]) => on)
            .map(([k]) => (k === "form" ? "forms" : k))
            .join(", ") || "none chosen"}
          . Up to {d.daily_application_cap} applications a day
          {d.channels.outreach
            ? ` and ${d.daily_outreach_cap} notes to hiring contacts`
            : ""}
          .
        </p>
        <p>Email used: {d.mailbox ?? "none"}.</p>
      </div>
      {d.problems.length > 0 && (
        <ul className="notice-warn list-disc pl-6">
          {d.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {live ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            Auto-Apply is {state === "paused" ? "paused" : "running"}: day{" "}
            {dash.data?.campaign.day} of 30.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              state === "paused" ? resume.mutate() : pause.mutate()
            }
          >
            {state === "paused" ? "Resume Auto-Apply" : "Pause Auto-Apply"}
          </button>
        </div>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>
              I agree that InterviewMeet may apply to jobs for me and write to
              employers from my email, using only details I confirmed. I can
              pause or stop at any time.
            </span>
          </label>
          <Fail error={enable.error} />
          <button
            type="button"
            className="btn-primary btn-lg"
            disabled={!agree || d.problems.length > 0 || enable.isPending}
            onClick={() =>
              enable.mutate(d.policy_version, {
                onSuccess: () => navigate("/auto-apply"),
              })
            }
          >
            {state === "ended" ? "Start another 30 days" : "Start Auto-Apply"}
          </button>
        </>
      )}
    </Section>
  );
}

export function SetupPage() {
  const profile = useAAProfile();
  if (profile.isPending) return <Loading label="Loading your search" />;
  if (!profile.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          Your search could not be loaded.
        </p>
      </main>
    );
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">
        Set up Auto-Apply
      </h1>
      <p className="text-sm text-muted">
        It finds roles that fit every day for 30 days and applies for you. You
        can follow along on the{" "}
        <Link to="/auto-apply" className="text-accent-dark underline">
          Auto-Apply page
        </Link>
        .
      </p>
      <FactsSection />
      <Section
        id="search-h"
        title="2. What to look for"
        hint="Roles, places and rules. A job is only applied to automatically when everything you marked as a must is clearly met."
      >
        <SearchForm key={profile.data.version} profile={profile.data} />
      </Section>
      <ChannelsSection profile={profile.data} />
      <AnswersSection />
      <StartSection />
    </main>
  );
}
