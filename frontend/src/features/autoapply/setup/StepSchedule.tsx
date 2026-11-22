import { Block, Switch } from "./controls";
import { type Draft, timeZones } from "./draft";

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hour = (h: number) =>
  h === 0 || h === 24
    ? "midnight"
    : h === 12
      ? "noon"
      : h < 12
        ? `${h} am`
        : `${h - 12} pm`;

/** Step 4: when, and how many a day. */
export function StepSchedule({
  d,
  set,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
}) {
  const total = d.cap * 30;
  return (
    <div className="space-y-8">
      <Block
        title="Your time zone"
        hint="Your 30 days start and end in your own time, and 'a day' means your day."
      >
        <label htmlFor="s-tz" className="sr-only">
          Your time zone
        </label>
        <select
          id="s-tz"
          className="input w-full sm:max-w-sm"
          value={d.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
        >
          {timeZones(d.timezone).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Block>

      <Block
        title="When can applications go out?"
        hint="Applications only go out inside these hours, in your time zone."
      >
        <div className="flex items-center gap-3">
          <Switch
            checked={d.anyHours}
            onChange={(v) => set({ anyHours: v })}
            label="Send at any time of day"
          />
          <span className="text-sm">
            {d.anyHours ? "Any time of day" : "Only between set hours"}
          </span>
        </div>
        {!d.anyHours && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="s-from" className="text-xs text-muted">
                From
              </label>
              <select
                id="s-from"
                className="input mt-1"
                value={d.start}
                onChange={(e) => set({ start: Number(e.target.value) })}
              >
                {HOURS.slice(0, 24).map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="s-to" className="text-xs text-muted">
                Until
              </label>
              <select
                id="s-to"
                className="input mt-1"
                value={d.end}
                onChange={(e) => set({ end: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Block>

      <Block
        title="How many a day?"
        hint="A steady number looks better to an employer than a flood."
      >
        <div className="rounded-2xl bg-canvas p-5">
          <p
            className="text-4xl font-semibold tracking-tight"
            aria-live="polite"
          >
            {d.cap}
            <span className="ml-2 text-base font-normal text-muted">
              application{d.cap === 1 ? "" : "s"} a day at most
            </span>
          </p>
          <label htmlFor="s-cap" className="sr-only">
            Most applications per day
          </label>
          <input
            id="s-cap"
            type="range"
            min={1}
            max={25}
            value={d.cap}
            onChange={(e) => set({ cap: Number(e.target.value) })}
            className="mt-3 block min-h-[44px] w-full accent-accent"
          />
          <p className="text-sm text-muted">
            Over 30 days that is up to {total} applications, and only to jobs
            that fit.
          </p>
        </div>
      </Block>
    </div>
  );
}
