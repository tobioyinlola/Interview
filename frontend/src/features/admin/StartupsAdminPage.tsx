import { useState, type FormEvent } from "react";

import {
  useAddDirectory,
  useDeleteDirectory,
  useImportStartups,
  useRefreshDirectory,
  useStartupsAdmin,
  useToggleDirectory,
} from "./api";
import { Empty, Failed, Loading, PageHead, Stat, Table, num, when } from "./ui";

const HINTS = [
  { v: "", l: "No region (use each company's country)" },
  { v: "us", l: "United States" },
  { v: "eu", l: "Europe" },
  { v: "uk", l: "United Kingdom" },
];

/** "Name, website, country, what they do" per line, as people paste them. */
function parse(text: string) {
  return text
    .split("\n")
    .map((l) => l.split(",").map((p) => p.trim()))
    .filter((p) => p[0] && p[1])
    .map(([name, website, country = "", ...rest]) => ({
      name,
      website,
      country,
      one_liner: rest.join(", "),
    }));
}

/** Where startups come from: the accelerator directories we read, and anything pasted in. */
export function StartupsAdminPage() {
  const q = useStartupsAdmin();
  const add = useAddDirectory();
  const toggle = useToggleDirectory();
  const del = useDeleteDirectory();
  const refresh = useRefreshDirectory();
  const imp = useImportStartups();
  const [form, setForm] = useState({ name: "", url: "", region_hint: "" });
  const [paste, setPaste] = useState({
    directory: "",
    region_hint: "",
    text: "",
  });
  if (q.isPending) return <Loading what="startups" />;
  if (q.isError) return <Failed what="startups" />;
  const d = q.data;
  const reading = refresh.isPending ? refresh.variables : null;

  const submitDir = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(form, {
      onSuccess: () => setForm({ name: "", url: "", region_hint: "" }),
    });
  };
  const submitPaste = (e: FormEvent) => {
    e.preventDefault();
    imp.mutate(
      {
        directory: paste.directory,
        region_hint: paste.region_hint,
        startups: parse(paste.text),
      },
      { onSuccess: () => setPaste({ ...paste, text: "" }) },
    );
  };
  const problem = (e: unknown) =>
    e instanceof Error ? (
      <p role="alert" className="notice-error">
        {e.message}
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHead
        title="Startups"
        intro="The accelerator directories we read, and what they have given us. Each is read again every week. Contacts are only addresses a startup publishes on its own site."
      />
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Startup totals"
      >
        <Stat label="Startups known" value={num(d.startups)} />
        <Stat
          label="Researched"
          value={num(d.by_status.researched ?? 0)}
          hint={`${d.by_status.new ?? 0} waiting, ${d.by_status.dead ?? 0} unreadable`}
        />
        <Stat label="With a contact" value={num(d.with_contacts)} />
        <Stat label="With an open role" value={num(d.with_openings)} />
      </dl>
      <p className="text-xs text-muted">
        By region:{" "}
        {Object.entries(d.by_region)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ") || "none yet"}
        . Companies with no region are never researched or written to.
      </p>

      <section className="space-y-3" aria-label="Directories">
        <h2 className="text-lg font-semibold">Directories</h2>
        {d.directories.length === 0 ? (
          <Empty>No directories yet.</Empty>
        ) : (
          <Table
            label="Directories"
            head={["Directory", "Last read", "Found", "New", "On", ""]}
          >
            {d.directories.map((x) => (
              <tr key={x.id}>
                <td className="px-4 py-3">
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium"
                  >
                    {x.name}
                  </a>
                  <span className="block text-xs text-muted">
                    {x.region_hint ? `region ${x.region_hint}` : "global"}
                    {x.builtin ? "" : " · added by us"}
                  </span>
                  {x.last_problem && (
                    <span className="block text-xs text-red-700">
                      {x.last_problem}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {x.last_run_at ? when(x.last_run_at) : "Not yet"}
                </td>
                <td className="px-4 py-3">{num(x.last_found)}</td>
                <td className="px-4 py-3">{num(x.last_added)}</td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Read ${x.name} every week`}
                    checked={x.enabled}
                    onChange={(e) =>
                      toggle.mutate({ id: x.id, enabled: e.target.checked })
                    }
                  />
                </td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={refresh.isPending}
                    onClick={() => refresh.mutate(x.id)}
                  >
                    {reading === x.id ? "Reading" : "Read now"}
                  </button>
                  {!x.builtin && (
                    <button
                      type="button"
                      className="btn-danger-outline btn-sm"
                      onClick={() => del.mutate(x.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {problem(refresh.error) ?? problem(del.error) ?? problem(toggle.error)}
      </section>

      <form onSubmit={submitDir} className="card space-y-3">
        <h2 className="text-lg font-semibold">Add a directory</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            className="input"
            placeholder="Name"
            aria-label="Directory name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input sm:col-span-2"
            placeholder="https://accelerator.example/portfolio"
            aria-label="Directory address"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input w-full sm:w-auto"
            aria-label="Region when a page gives no country"
            value={form.region_hint}
            onChange={(e) => setForm({ ...form, region_hint: e.target.value })}
          >
            {HINTS.map((h) => (
              <option key={h.v} value={h.v}>
                {h.l}
              </option>
            ))}
          </select>
          {problem(add.error)}
          <button
            className="btn-primary"
            disabled={!form.name.trim() || !form.url.trim() || add.isPending}
          >
            Add directory
          </button>
        </div>
      </form>

      <form onSubmit={submitPaste} className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Paste companies</h2>
          <p className="text-sm text-muted">
            For pages that only show in a browser. One per line:{" "}
            <code>Name, website, country, what they do</code>.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Where they are from, e.g. Techstars Berlin"
            aria-label="Source name"
            value={paste.directory}
            onChange={(e) => setPaste({ ...paste, directory: e.target.value })}
          />
          <select
            className="input"
            aria-label="Region when no country is given"
            value={paste.region_hint}
            onChange={(e) =>
              setPaste({ ...paste, region_hint: e.target.value })
            }
          >
            {HINTS.map((h) => (
              <option key={h.v} value={h.v}>
                {h.l}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="input w-full"
          rows={6}
          aria-label="Companies"
          value={paste.text}
          onChange={(e) => setPaste({ ...paste, text: e.target.value })}
          placeholder={"Acme, acme.io, Germany, Payments for marketplaces"}
        />
        {problem(imp.error)}
        {imp.data && (
          <p role="status" className="notice-info">
            Added {imp.data.added}, skipped {imp.data.skipped} (already known or
            not a company website).
          </p>
        )}
        <button
          className="btn-primary"
          disabled={
            !paste.directory.trim() ||
            parse(paste.text).length === 0 ||
            imp.isPending
          }
        >
          Import
        </button>
      </form>
    </div>
  );
}
