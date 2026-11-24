import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PAGE, type AdminStartup, useOpenRoles, useStartupList } from "./api";
import { Empty, Failed, Loading, PageHead, num, when } from "./ui";

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["researched", "Researched"],
  ["new", "Waiting"],
  ["dead", "Unreadable"],
  ["contacts", "With a contact"],
  ["openings", "With an open role"],
];
const REGIONS: [string, string][] = [
  ["", "Every region"],
  ["us", "United States"],
  ["eu", "Europe"],
  ["uk", "United Kingdom"],
  ["other", "No region"],
];
const STATUS: Record<string, string> = {
  new: "Waiting to be researched",
  researched: "Researched",
  dead: "Site could not be read",
};

function Pager({
  page,
  total,
  go,
}: {
  page: number;
  total: number;
  go: (p: number) => void;
}) {
  const last = Math.max(0, Math.ceil(total / PAGE) - 1);
  if (total <= PAGE) return null;
  return (
    <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={page === 0}
        onClick={() => go(page - 1)}
      >
        Previous
      </button>
      <span className="text-muted">
        Page {page + 1} of {last + 1}
      </span>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={page >= last}
        onClick={() => go(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

function Search({
  value,
  onSearch,
  label,
}: {
  value: string;
  onSearch: (q: string) => void;
  label: string;
}) {
  const [text, setText] = useState(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(text.trim());
  };
  return (
    <form onSubmit={submit} className="flex gap-2" role="search">
      <input
        type="search"
        className="input w-full sm:w-72"
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn-secondary">
        Search
      </button>
    </form>
  );
}

function Card({ s }: { s: AdminStartup }) {
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={s.website}
            target="_blank"
            rel="noreferrer"
            className="text-lg font-semibold hover:underline"
          >
            {s.name}
          </a>
          <a
            href={s.website}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-sm text-accent-dark hover:underline"
          >
            {s.website}
          </a>
        </div>
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-dark">
          {STATUS[s.status] ?? s.status}
        </span>
      </div>

      <p className="text-sm text-muted">
        {[
          s.country ? `${s.country} (${s.region})` : `region ${s.region}`,
          s.sector,
          s.batch ? `batch ${s.batch}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        {" · "}
        listed by{" "}
        <a
          href={s.directory_url}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {s.directory}
        </a>
        {s.researched_at ? ` · researched ${when(s.researched_at)}` : ""}
      </p>

      {s.one_liner && (
        <p className="text-sm">
          <span className="font-medium">Directory says: </span>
          {s.one_liner}
        </p>
      )}
      {s.summary && (
        <p className="text-sm">
          <span className="font-medium">Its own site says: </span>
          {s.summary}
        </p>
      )}

      <div>
        <h3 className="text-sm font-medium">
          Open roles ({s.openings.length})
          {s.hiring && s.openings.length === 0 && (
            <span className="ml-2 font-normal text-muted">
              the site says it is hiring but names no roles
            </span>
          )}
        </h3>
        {s.openings.length === 0 ? (
          <p className="text-sm text-muted">None found.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {s.openings.map((o) => (
              <li
                key={`${o.title}-${o.url}`}
                className="flex flex-wrap gap-x-3"
              >
                <span>{o.title}</span>
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-accent-dark hover:underline"
                >
                  Apply link
                </a>
              </li>
            ))}
          </ul>
        )}
        {s.careers_url && (
          <p className="mt-1 text-sm">
            Careers page:{" "}
            <a
              href={s.careers_url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-accent-dark hover:underline"
            >
              {s.careers_url}
            </a>
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">
          Contacts they publish ({s.contacts.length})
        </h3>
        {s.contacts.length === 0 ? (
          <p className="text-sm text-muted">None found.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {s.contacts.map((c) => (
              <li key={c.email}>
                <span className="break-all">{c.email}</span>{" "}
                <span className="text-muted">
                  {[c.name, c.title, c.kind].filter(Boolean).join(" · ")}
                </span>{" "}
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-dark hover:underline"
                >
                  where it is published
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The startups behind the totals, one card each: where to find them, what they do, who listed them,
 *  their open roles with apply links, and the contacts they publish. */
export function StartupListPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const region = params.get("region") ?? "";
  const directory = params.get("directory") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const list = useStartupList({ filter, region, directory, q, page });
  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: "0", ...next }))
      if (v) p.set(k, v);
      else p.delete(k);
    setParams(p);
  };

  if (list.isPending) return <Loading what="startups" />;
  if (list.isError) return <Failed what="startups" />;
  const d = list.data;
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link to="/admin/startups" className="text-accent-dark hover:underline">
          Startups
        </Link>{" "}
        / list
      </p>
      <PageHead
        title="Startups found"
        intro={`${num(d.total)} ${d.total === 1 ? "startup" : "startups"}${
          directory ? ` from ${directory}` : ""
        }. Each name opens its website.`}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => set({ filter: k === "all" ? "" : k })}
            className={
              filter === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"
            }
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input"
          aria-label="Region"
          value={region}
          onChange={(e) => set({ region: e.target.value })}
        >
          {REGIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Search
          value={q}
          onSearch={(v) => set({ q: v })}
          label="Search name, website or what they do"
        />
        {directory && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => set({ directory: "" })}
          >
            From {directory}: show every directory
          </button>
        )}
      </div>

      {d.items.length === 0 ? (
        <Empty>No startups match that.</Empty>
      ) : (
        <ul className="space-y-4" aria-label="Startups">
          {d.items.map((s) => (
            <Card key={s.id} s={s} />
          ))}
        </ul>
      )}
      <Pager page={page} total={d.total} go={(p) => set({ page: String(p) })} />
    </div>
  );
}

/** Every open role found on the startups' own sites, with the startup and where to apply. */
export function OpenRolesPage() {
  const [params, setParams] = useSearchParams();
  const region = params.get("region") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const roles = useOpenRoles({ region, q, page });
  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: "0", ...next }))
      if (v) p.set(k, v);
      else p.delete(k);
    setParams(p);
  };

  if (roles.isPending) return <Loading what="open roles" />;
  if (roles.isError) return <Failed what="open roles" />;
  const d = roles.data;
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link to="/admin/startups" className="text-accent-dark hover:underline">
          Startups
        </Link>{" "}
        / open roles
      </p>
      <PageHead
        title="Open roles"
        intro={`${num(d.total)} ${d.total === 1 ? "role" : "roles"} at ${num(
          d.startups,
        )} ${d.startups === 1 ? "startup" : "startups"}, read from the startups' own careers pages. The apply link goes to the role, or to the careers page when the role has no page of its own.`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input"
          aria-label="Region"
          value={region}
          onChange={(e) => set({ region: e.target.value })}
        >
          {REGIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Search
          value={q}
          onSearch={(v) => set({ q: v })}
          label="Search role or startup"
        />
      </div>

      {d.items.length === 0 ? (
        <Empty>
          No open roles found yet. They appear once a startup&apos;s careers
          page has been read.
        </Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Open roles">
          {d.items.map((r) => (
            <li
              key={`${r.startup_id}-${r.title}-${r.url}`}
              className="card flex flex-col gap-2 !p-4"
            >
              <h2 className="text-base font-semibold">{r.title}</h2>
              <p className="text-sm">
                <a
                  href={r.website}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {r.startup}
                </a>
                <span className="block text-xs text-muted">
                  {r.country ? `${r.country} (${r.region})` : r.region} · listed
                  by {r.directory}
                </span>
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-sm"
                >
                  Apply link
                </a>
                {r.careers_url && r.careers_url !== r.url && (
                  <a
                    href={r.careers_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-dark hover:underline"
                  >
                    Careers page
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={d.total} go={(p) => set({ page: String(p) })} />
    </div>
  );
}
