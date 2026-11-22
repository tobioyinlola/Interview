import { MultiPick } from "../../../ui/Pickers";
import { Block, Pill, Priority, Segmented } from "./controls";
import { CURRENCIES, type Draft, PERIODS } from "./draft";

const SENIORITY = ["intern", "junior", "mid", "senior", "lead", "executive"];
const CONTRACTS = ["full_time", "part_time", "contract", "internship"];
const label = (v: string) => v.replace("_", " ");
const INDUSTRIES = [
  "Fintech",
  "Healthcare",
  "Education",
  "E-commerce",
  "Software",
  "Logistics",
  "Media",
  "Energy",
  "Telecoms",
  "Agriculture",
  "Government",
  "Non-profit",
];

/** Step 3: everything else they care about. All optional. */
export function StepPreferences({
  d,
  set,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
}) {
  const flip = (key: "seniority" | "contract", v: string) =>
    set({
      [key]: d[key].includes(v)
        ? d[key].filter((x) => x !== v)
        : [...d[key], v],
    });
  return (
    <div className="space-y-8">
      <p className="rounded-2xl bg-accent-soft p-4 text-sm">
        Everything here is optional. <b>Must have</b> means a job that does not
        clearly match is left alone. <b>Nice to have</b> only puts better
        matches first.
      </p>
      <Block
        title="Seniority"
        right={
          d.seniority.length > 0 && (
            <Priority
              label="How strict is seniority"
              required={d.seniorityReq}
              onChange={(v) => set({ seniorityReq: v })}
            />
          )
        }
      >
        <div className="flex flex-wrap gap-2">
          {SENIORITY.map((s) => (
            <Pill
              key={s}
              selected={d.seniority.includes(s)}
              onClick={() => flip("seniority", s)}
            >
              {label(s)}
            </Pill>
          ))}
        </div>
      </Block>
      <Block
        title="Type of work"
        right={
          d.contract.length > 0 && (
            <Priority
              label="How strict is the contract type"
              required={d.contractReq}
              onChange={(v) => set({ contractReq: v })}
            />
          )
        }
      >
        <div className="flex flex-wrap gap-2">
          {CONTRACTS.map((s) => (
            <Pill
              key={s}
              selected={d.contract.includes(s)}
              onClick={() => flip("contract", s)}
            >
              {label(s)}
            </Pill>
          ))}
        </div>
      </Block>
      <Block
        title="Industries"
        right={
          d.industries.length > 0 && (
            <Priority
              label="How strict is the industry"
              required={d.industriesReq}
              onChange={(v) => set({ industriesReq: v })}
            />
          )
        }
      >
        <MultiPick
          id="s-inds"
          label="Industries you like"
          values={d.industries}
          onChange={(v) => set({ industries: v })}
          suggestions={INDUSTRIES}
          addLabel="Add industry"
        />
      </Block>
      <Block
        title="Lowest pay you will take"
        hint="Compared only with jobs that give pay in the same currency and the same period."
        right={
          d.salaryFloor.trim() && (
            <Priority
              label="How strict is the pay"
              required={d.salaryReq}
              onChange={(v) => set({ salaryReq: v })}
            />
          )
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="s-floor" className="text-xs text-muted">
              Amount
            </label>
            <input
              id="s-floor"
              inputMode="decimal"
              className="input mt-1 w-36"
              value={d.salaryFloor}
              onChange={(e) =>
                set({ salaryFloor: e.target.value.replace(/[^\d.]/g, "") })
              }
              placeholder="90000"
            />
          </div>
          <div>
            <label htmlFor="s-cur" className="text-xs text-muted">
              Currency
            </label>
            <select
              id="s-cur"
              className="input mt-1"
              value={d.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <Segmented
            label="Pay period"
            value={d.period}
            onChange={(v) => set({ period: v })}
            options={PERIODS.slice(2).map((p) => ({
              value: p,
              label: `per ${p}`,
            }))}
          />
        </div>
      </Block>
      <Block
        title="Visa sponsorship"
        right={
          d.need && (
            <Priority
              label="How strict is sponsorship"
              required={d.sponsorReq}
              onChange={(v) => set({ sponsorReq: v })}
            />
          )
        }
      >
        <Segmented
          label="Visa sponsorship"
          value={d.need}
          onChange={(v) => set({ need: v })}
          options={[
            { value: "", label: "Does not matter" },
            { value: "needed", label: "I need sponsorship" },
            { value: "not_needed", label: "I do not" },
          ]}
        />
      </Block>
    </div>
  );
}
