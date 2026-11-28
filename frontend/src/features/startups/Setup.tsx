import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/client";
import {
  Block,
  Segmented,
  StepHeader,
  Switch,
} from "../autoapply/setup/controls";
import { useSaveHuntSettings, type HuntSettings } from "./api";

const REGIONS = [
  { id: "us", label: "United States" },
  { id: "eu", label: "Europe" },
  { id: "uk", label: "United Kingdom" },
];

const STEPS = ["What you want", "How you sound", "Sending"];

/** Three short steps instead of one long form. Saved once, at the end. */
export function Setup({ s, onDone }: { s: HuntSettings; onDone: () => void }) {
  const save = useSaveHuntSettings();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    enabled: s.enabled || s.ready.length === 0,
    regions: s.regions,
    roles: s.roles.join(", "),
    pitch: s.pitch,
    daily_cap: s.daily_cap,
    auto_send: s.auto_send,
    sender_name: s.sender_name,
    postal_address: s.postal_address,
    reach: s.reach ?? "most",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const toggleRegion = (id: string) =>
    set(
      "regions",
      form.regions.includes(id)
        ? form.regions.filter((r) => r !== id)
        : [...form.regions, id],
    );
  const roles = form.roles
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const can = [
    roles.length > 0 && form.regions.length > 0,
    form.sender_name.trim() !== "",
    true,
  ];
  const last = step === STEPS.length - 1;
  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? "Could not save."
        : null;
  const finish = () =>
    save.mutate(
      { ...form, roles, enabled: s.mailbox ? form.enabled : false },
      { onSuccess: onDone },
    );

  return (
    <section className="card space-y-6" aria-label="Set up startup outreach">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          className="flex gap-1.5"
        >
          {STEPS.map((n, i) => (
            <span
              key={n}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-canvas"}`}
            />
          ))}
        </div>
      </div>

      {s.prefilled && step === 0 && (
        <p className="notice-info">
          Filled in from your Auto-Apply search and CV. Change anything you
          like.
        </p>
      )}

      {step === 0 && (
        <div className="space-y-5">
          <StepHeader
            n={1}
            title="Who should we look for?"
            intro="The roles you want, and where the startups are."
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              Roles you want, separated by commas
            </span>
            <input
              className="input w-full"
              value={form.roles}
              onChange={(e) => set("roles", e.target.value)}
              placeholder="Senior Product Manager, Head of Product"
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Where to look</legend>
            <div className="flex flex-wrap gap-x-5">
              {REGIONS.map((r) => (
                <label key={r.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.regions.includes(r.id)}
                    onChange={() => toggleRegion(r.id)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <StepHeader
            n={2}
            title="How should you sound?"
            intro="Each pitch is short and uses only your real CV and these words."
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              What you offer, in a sentence or two
            </span>
            <textarea
              className="input w-full"
              rows={3}
              maxLength={1200}
              value={form.pitch}
              onChange={(e) => set("pitch", e.target.value)}
              placeholder="I turn messy payments problems into clear roadmaps."
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name to sign with</span>
              <input
                className="input w-full"
                value={form.sender_name}
                onChange={(e) => set("sender_name", e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Postal address (optional)
              </span>
              <input
                className="input w-full"
                value={form.postal_address}
                onChange={(e) => set("postal_address", e.target.value)}
              />
              <span className="block text-xs text-muted">
                Not added to your emails unless the operator turns that on.
              </span>
            </label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <StepHeader
            n={3}
            title="How should we send?"
            intro="From your own email, in working hours, a few a day."
          />
          <Block
            title="Your email"
            hint={
              s.mailbox
                ? `Pitches go from ${s.mailbox}.`
                : "Connect your email so pitches come from you."
            }
            right={
              !s.mailbox && (
                <Link
                  to="/settings/email?next=/startups"
                  className="btn-secondary btn-sm"
                >
                  Connect
                </Link>
              )
            }
          >
            <span />
          </Block>
          <Block
            title="How far to reach"
            hint={
              form.reach === "best"
                ? "Only startups that are a strong fit, or have a matching opening."
                : form.reach === "everyone"
                  ? "Every startup we have an address for, best fits first. Fewer will reply."
                  : "Startups with a fair fit or a matching opening, best fits first."
            }
          >
            <Segmented<"best" | "most" | "everyone">
              label="How far to reach"
              value={form.reach}
              onChange={(v) => set("reach", v)}
              options={[
                { value: "best", label: "Best matches" },
                { value: "most", label: "Most" },
                { value: "everyone", label: "Everyone" },
              ]}
            />
          </Block>
          <Block
            title={`Most pitches a day: ${form.daily_cap}`}
            hint="Weekdays only. It starts at about 10 a day and rises over your first three weeks, so your mailbox is not flagged."
          >
            <input
              type="range"
              min={1}
              max={25}
              value={form.daily_cap}
              onChange={(e) => set("daily_cap", Number(e.target.value))}
              className="w-full"
              aria-label="Most pitches a day"
            />
          </Block>
          <Block
            title="Send without asking me"
            hint="Off: you approve each pitch first. We recommend this at the start."
            right={
              <Switch
                label="Send without asking me"
                checked={form.auto_send}
                onChange={(v) => set("auto_send", v)}
              />
            }
          >
            <span />
          </Block>
          <Block
            title="Turn startup outreach on"
            right={
              <Switch
                label="Turn startup outreach on"
                checked={form.enabled && !!s.mailbox}
                onChange={(v) => set("enabled", v)}
              />
            }
          >
            <span />
          </Block>
          <p className="text-xs text-muted">
            At most one follow-up after five quiet days, never to anyone who
            said no, and every note says where we found the address and how to
            opt out.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            className="btn-secondary btn-lg"
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
        )}
        <button
          type="button"
          className="btn-primary btn-lg flex-1 sm:flex-none"
          disabled={!can[step] || save.isPending}
          onClick={last ? finish : () => setStep(step + 1)}
        >
          {last ? (save.isPending ? "Saving" : "Save") : "Next"}
        </button>
      </div>
    </section>
  );
}
