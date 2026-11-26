import { useReach } from "./api";

/** The top of every Startups screen: what this does for you, in one line, with the real number. */
export function StartupHero() {
  const reach = useReach();
  const label =
    reach.data && reach.data.companies >= 10 ? reach.data.label : null;
  return (
    <header className="rounded-3xl bg-gradient-to-br from-ink via-ink to-accent-dark p-6 text-surface shadow-lift sm:p-8">
      <p className="text-sm font-medium text-surface/70">Startup outreach</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
        Auto outreach to {label ? `${label} companies` : "companies"} that need
        you
      </h1>
      <p className="mt-3 max-w-xl text-surface/85">
        We write to startups hiring for your role, from your Gmail. You approve
        each one.
      </p>
    </header>
  );
}
