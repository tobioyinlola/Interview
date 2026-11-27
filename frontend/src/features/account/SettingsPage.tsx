import { type FormEvent, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  useAnalyticsPreference,
  useChangePassword,
  useDeleteAccount,
  useMe,
  useSaveProfile,
} from "../../api/hooks";
import { CvPanel } from "../notes/NotesPage";
import { EmailTab } from "./EmailTab";
import { COUNTRIES } from "../../data/countries";
import { PasswordField } from "../../ui/PasswordField";
import { CountrySelect, RoleInput } from "../../ui/Pickers";
import { PasswordRules, passwordOk } from "../auth/password";
import { browserSaysNo } from "../../analytics/client";
import { trackFeature } from "../../analytics";
import { capability, privacy, usePrivacy } from "../../app/privacy";
import { PrivateScreen } from "../../app/usePrivateScreen";

export function PrivacyNotice() {
  return (
    <section aria-labelledby="privacy" className="card space-y-2">
      <h2 id="privacy" className="text-lg font-semibold">
        Privacy and responsible use
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          Everyone on a call must know the assistant is on. In a real interview,
          real-time answers are only for when the interviewer or organisation
          has allowed them; otherwise use a Standard interview.
        </li>
        <li>
          Recording and transcribing calls is regulated differently in different
          places. Get your partner&apos;s agreement and follow local law.
        </li>
        <li>
          Audio is relayed for transcription and discarded. Only text is saved.
        </li>
        <li>
          Audio and text are processed by OpenAI to transcribe, research and
          write outlines. Your content is not used to train models.
        </li>
        <li>
          You can delete a session, a company, or your whole account at any
          time.
        </li>
      </ul>
      <p className="text-sm">
        Read the full{" "}
        <Link to="/privacy" className="text-accent-dark underline">
          privacy notice
        </Link>{" "}
        and the{" "}
        <Link to="/terms" className="text-accent-dark underline">
          terms of use
        </Link>
        .
      </p>
    </section>
  );
}

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteAccount();
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <button
        className="btn-danger-outline"
        onClick={() => setConfirming(true)}
      >
        Delete my account and data
      </button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label="Confirm deletion"
      className="card space-y-2 !bg-red-50"
    >
      <p>
        This permanently deletes your CV, companies, sessions and account. It
        disappears from the app immediately and from storage within 30 days.
      </p>
      <div className="flex gap-2">
        <button
          className="btn-danger"
          disabled={del.isPending}
          onClick={() =>
            del.mutate(undefined, { onSuccess: () => navigate("/login") })
          }
        >
          {del.isPending ? "Deleting…" : "Yes, delete everything"}
        </button>
        <button className="btn-secondary" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {del.isError && (
        <p role="alert" className="text-sm text-red-700">
          {del.error.message}
        </p>
      )}
    </div>
  );
}

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "cv", label: "CV" },
  { id: "email", label: "Email" },
  { id: "auto-apply", label: "Auto-Apply" },
  { id: "privacy", label: "Privacy and data" },
] as const;

/** One field of the profile form. */
function Field({
  id,
  label,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input id={id} className="input mt-1 w-full" {...rest} />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** "Lagos, Nigeria" becomes a city and a country from the list; anything else stays as the city. */
function splitPlace(place: string): { city: string; country: string } {
  const text = place.trim();
  const hit = COUNTRIES.find(
    (c) => text === c || text.toLowerCase().endsWith(`, ${c.toLowerCase()}`),
  );
  if (!hit) return { city: text, country: "" };
  return {
    city: text.slice(0, text.length - hit.length).replace(/,\s*$/, ""),
    country: hit,
  };
}
const joinPlace = (city: string, country: string) =>
  [city.trim(), country].filter(Boolean).join(", ");

function ProfileTab() {
  const { data: me } = useMe();
  const save = useSaveProfile();
  const place = splitPlace(me?.location ?? "");
  const start = {
    name: me?.full_name ?? "",
    phone: me?.phone ?? "",
    city: place.city,
    country: place.country,
    headline: me?.headline ?? "",
    linkedin: me?.linkedin_url ?? "",
  };
  const [f, setF] = useState(start);
  const set = (k: keyof typeof start, v: string) => setF({ ...f, [k]: v });
  const changed = (Object.keys(start) as (keyof typeof start)[]).some(
    (k) => f[k].trim() !== start[k],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    save.mutate(
      {
        full_name: f.name.trim(),
        phone: f.phone.trim(),
        location: joinPlace(f.city, f.country),
        headline: f.headline.trim(),
        linkedin_url: f.linkedin.trim(),
      },
      {
        // show it as saved and tidied, not as typed
        onSuccess: (m) =>
          setF({
            name: m.full_name ?? "",
            phone: m.phone ?? "",
            ...splitPlace(m.location ?? ""),
            headline: m.headline ?? "",
            linkedin: m.linkedin_url ?? "",
          }),
      },
    );
  };
  return (
    <section aria-labelledby="profile-h" className="card space-y-4">
      <div>
        <h2 id="profile-h" className="text-lg font-semibold">
          Your details
        </h2>
        <p className="text-sm text-muted">
          Used to greet you and to fill in applications. Only your name is
          required.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="profile-name"
            label="Full name"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            autoComplete="name"
            maxLength={120}
          />
          <Field
            id="profile-email"
            label="Email address"
            value={me?.email ?? ""}
            readOnly
            aria-readonly="true"
            hint="This is how you sign in, so it cannot be changed here."
          />
          <Field
            id="profile-phone"
            label="Phone number"
            type="tel"
            inputMode="tel"
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
            autoComplete="tel"
            placeholder="+234 801 234 5678"
          />
          <CountrySelect
            id="profile-country"
            label="Country"
            value={f.country}
            onChange={(v) => set("country", v)}
          />
          <Field
            id="profile-city"
            label="City or town"
            value={f.city}
            onChange={(e) => set("city", e.target.value)}
            autoComplete="address-level2"
            maxLength={80}
            placeholder="Lagos"
          />
          <RoleInput
            id="profile-headline"
            label="What you do"
            value={f.headline}
            onChange={(v) => set("headline", v)}
            hint="Pick a role from the list, or type your own."
          />
          <Field
            id="profile-linkedin"
            label="LinkedIn or portfolio link"
            inputMode="url"
            autoCapitalize="none"
            value={f.linkedin}
            onChange={(e) => set("linkedin", e.target.value)}
            maxLength={300}
            placeholder="https://linkedin.com/in/you"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!changed || f.name.trim().length < 2 || save.isPending}
            className="btn-primary"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          {save.isSuccess && !changed && (
            <p role="status" className="text-sm text-muted">
              Saved.
            </p>
          )}
        </div>
        {save.isError && (
          <p role="alert" className="notice-error">
            {save.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

function PasswordTab() {
  const { data: me } = useMe();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const had = me?.has_password ?? false;
  const mismatch = again.length > 0 && next !== again;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || !passwordOk(next)) return;
    change.mutate(
      { current_password: had ? current : undefined, new_password: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setAgain("");
        },
      },
    );
  };
  return (
    <section aria-labelledby="pw-h" className="card space-y-4">
      <div>
        <h2 id="pw-h" className="text-lg font-semibold">
          {had ? "Change your password" : "Set a password"}
        </h2>
        <p className="text-sm text-muted">
          {had
            ? "You will stay signed in here and be signed out everywhere else."
            : "You sign in with an emailed link or Google. Add a password if you also want to sign in with one."}{" "}
          Use at least 8 characters with a symbol, like ! or @.
        </p>
      </div>
      <form onSubmit={submit} className="max-w-md space-y-4">
        {had && (
          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        )}
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
        />
        <PasswordRules password={next} />
        <PasswordField
          label="Repeat the new password"
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          invalid={mismatch}
        />
        {mismatch && (
          <p role="alert" className="text-sm text-red-700">
            The two new passwords are not the same.
          </p>
        )}
        {change.isError && (
          <p role="alert" className="notice-error">
            {change.error.message}
          </p>
        )}
        {change.isSuccess && (
          <p role="status" className="text-sm">
            ✓ Password saved. We emailed you to say so.
          </p>
        )}
        <button
          type="submit"
          className="btn-primary"
          disabled={change.isPending || mismatch || !passwordOk(next)}
        >
          {change.isPending
            ? "Saving…"
            : had
              ? "Change password"
              : "Set password"}
        </button>
      </form>
    </section>
  );
}

/** What this device can do to keep private screens out of screen capture, said honestly, and the
 *  two switches: protect private screens, and Presentation mode. */
function ScreenPrivacy() {
  const cap = capability();
  const { enabled, presentation, problem } = usePrivacy();
  return (
    <section aria-labelledby="screen-privacy" className="card space-y-3">
      <h2 id="screen-privacy" className="text-lg font-semibold">
        Screen sharing and recording
      </h2>
      <p className="text-sm">{cap.summary}</p>
      {cap.limits.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {cap.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Private screens are your profile, password, CV, email connection and the
        back office. Live interview screens are never hidden, so anyone watching
        can see the assistant is on.
      </p>
      {cap.method !== "none" && (
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => privacy.setEnabled(e.target.checked)}
            className="h-5 w-5 accent-accent"
          />
          Protect private screens
        </label>
      )}
      <label className="flex min-h-[44px] items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={presentation}
          onChange={(e) => privacy.setPresentation(e.target.checked)}
          className="h-5 w-5 accent-accent"
        />
        Presentation mode: hide private screens while I share my screen
      </label>
      {problem && (
        <p role="alert" className="notice-error">
          {problem}
        </p>
      )}
    </section>
  );
}

/** The switch for usage statistics: on until turned off, on every device, and off deletes. */
function UsageStatistics() {
  const me = useMe();
  const save = useAnalyticsPreference();
  const off = me.data?.analytics_opt_out === true;
  const browser = browserSaysNo();
  return (
    <section aria-labelledby="usage-stats" className="card space-y-3">
      <h2 id="usage-stats" className="text-lg font-semibold">
        Usage statistics
      </h2>
      <p className="text-sm">
        To make InterviewMeet better we count which screens are opened, how long
        the app is in use, which buttons are used, when something breaks and how
        long it takes to open, on the website and in the apps.
      </p>
      <p className="text-sm text-muted">
        It never includes what you type, say, upload or see: no CV, answers,
        transcripts, notes or company names. Kept for 90 days.
      </p>
      <label className="flex min-h-[44px] items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={!off}
          disabled={save.isPending || !me.data}
          onChange={(e) => {
            if (e.target.checked)
              trackFeature("privacy_toggle", { detail: "stats_on" });
            save.mutate(!e.target.checked);
          }}
          className="h-5 w-5 accent-accent"
        />
        Share usage statistics, on all my devices
      </label>
      {off && (
        <p role="status" className="text-sm text-muted">
          Off. Nothing is collected on any of your devices, and what was
          collected about you has been deleted.
        </p>
      )}
      {browser && (
        <p className="text-sm text-muted">
          Your browser asks not to be tracked, so nothing is sent from it
          whatever this says.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="notice-error">
          {save.error.message}
        </p>
      )}
    </section>
  );
}

function AutoApplyTab() {
  return (
    <section aria-labelledby="aa-prefs" className="card space-y-3">
      <h2 id="aa-prefs" className="text-lg font-semibold">
        Search preferences
      </h2>
      <p className="text-sm text-muted">
        The roles, places, industries, pay and other choices Auto-Apply uses
        when it looks for jobs for you.
      </p>
      <Link to="/auto-apply/setup" className="btn-secondary">
        Edit your search preferences
      </Link>
    </section>
  );
}

function PrivacyTab() {
  return (
    <>
      <PrivacyNotice />
      <UsageStatistics />
      <ScreenPrivacy />
      <section aria-labelledby="danger" className="card space-y-2 !bg-red-50">
        <h2 id="danger" className="text-lg font-semibold">
          Delete my data
        </h2>
        <DeleteAccountButton />
      </section>
    </>
  );
}

export function SettingsPage() {
  const { tab = "profile" } = useParams();
  if (!TABS.some((t) => t.id === tab))
    return <Navigate to="/settings/profile" replace />;
  return (
    <main className="page-wide lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-x-8 lg:gap-y-5 lg:space-y-0">
      <h1 className="text-3xl font-semibold tracking-tight lg:col-span-2">
        Settings
      </h1>
      <nav
        aria-label="Settings sections"
        data-settings-nav=""
        className="lg:col-start-1 lg:row-start-2 lg:self-start -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:overflow-visible"
      >
        <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
          {TABS.map((t) => (
            <li key={t.id}>
              <NavLink
                to={`/settings/${t.id}`}
                className={({ isActive }) =>
                  `inline-flex min-h-[44px] items-center rounded-full px-4 text-sm transition-colors lg:flex lg:rounded-xl ${
                    isActive
                      ? "bg-ink font-medium text-surface"
                      : "bg-surface text-muted shadow-card hover:text-ink"
                  }`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 max-w-4xl space-y-5 lg:col-start-2 lg:row-start-2">
        {tab !== "privacy" && (
          <PrivateScreen>
            {tab === "profile" && <ProfileTab />}
            {tab === "password" && <PasswordTab />}
            {tab === "cv" && <CvPanel />}
            {tab === "email" && <EmailTab />}
            {tab === "auto-apply" && <AutoApplyTab />}
          </PrivateScreen>
        )}
        {tab === "privacy" && <PrivacyTab />}
      </div>
    </main>
  );
}
