import { ALL_COUNTRIES, COUNTRIES, REGIONS } from "../../../data/countries";
import { ROLES } from "../../../data/roles";
import { MultiPick } from "../../../ui/Pickers";
import { Block, OptionTile, Priority } from "./controls";
import type { Draft } from "./draft";

const STYLES: { id: string; icon: string; title: string; hint: string }[] = [
  {
    id: "remote",
    icon: "🏠",
    title: "Remote",
    hint: "Work from anywhere you are allowed",
  },
  { id: "hybrid", icon: "🔀", title: "Hybrid", hint: "Some days at an office" },
  {
    id: "onsite",
    icon: "🏢",
    title: "On-site",
    hint: "At the company's office",
  },
];

/** Step 2: the role, the place, and how they want to work. */
export function StepRole({
  d,
  set,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
}) {
  const everywhere = d.locations.includes(ALL_COUNTRIES);
  const toggle = (id: string) =>
    set({
      arrangement: d.arrangement.includes(id)
        ? d.arrangement.filter((x) => x !== id)
        : [...d.arrangement, id],
    });
  return (
    <div className="space-y-8">
      <Block
        title="Which roles do you want?"
        right={
          <Priority
            label="How strict is the role"
            required={d.rolesReq}
            onChange={(v) => set({ rolesReq: v })}
          />
        }
      >
        <MultiPick
          id="s-roles"
          label="Roles you want"
          values={d.roles}
          onChange={(v) => set({ roles: v })}
          suggestions={ROLES}
          addLabel="Add role"
          hint="Pick from the list or type your own, then add it. Add as many as you like."
        />
      </Block>
      <Block
        title="Where can you work?"
        hint="A remote job only counts when the listing says people in your country can apply."
        right={
          <Priority
            label="How strict is the place"
            required={d.locationsReq}
            onChange={(v) => set({ locationsReq: v })}
          />
        }
      >
        <div className="space-y-3">
          <OptionTile
            selected={everywhere}
            onClick={() =>
              set({ locations: everywhere ? [] : [ALL_COUNTRIES] })
            }
            icon="🌍"
            title="All countries"
            hint="Apply wherever I can be hired: no country is held against a job"
          />
          <MultiPick
            id="s-locs"
            label="Where you can work: a country or region"
            values={d.locations}
            onChange={(v) =>
              set({
                // picking a country after "All countries" means a narrower search
                locations:
                  v.length > 1 ? v.filter((x) => x !== ALL_COUNTRIES) : v,
              })
            }
            suggestions={[...REGIONS, ...COUNTRIES]}
            addLabel="Add place"
          />
        </div>
      </Block>
      <Block
        title="How do you want to work?"
        hint="Pick any that suit you, or none if it does not matter."
        right={
          d.arrangement.length > 0 && (
            <Priority
              label="How strict is the work style"
              required={d.arrangementReq}
              onChange={(v) => set({ arrangementReq: v })}
            />
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {STYLES.map((s) => (
            <OptionTile
              key={s.id}
              selected={d.arrangement.includes(s.id)}
              onClick={() => toggle(s.id)}
              icon={s.icon}
              title={s.title}
              hint={s.hint}
              stacked
            />
          ))}
        </div>
      </Block>
    </div>
  );
}
