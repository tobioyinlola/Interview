import { useState } from "react";

import { useEmails, useTemplatePreview, useTemplates } from "./api";
import { Empty, Failed, Loading, PageHead, Table, num, when } from "./ui";

/** Every email the platform sends: how each kind is doing, who was emailed and whether it arrived,
 *  and a preview of each template with sample data. Never the body of a real message. */
export function EmailsAdminPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const log = useEmails({ kind, status, q });
  const templates = useTemplates();
  const p = useTemplatePreview(preview);

  return (
    <div className="space-y-6">
      <PageHead
        title="Emails"
        intro="What goes out and whether it arrived. Open a template to see exactly what people receive."
      />

      <section aria-labelledby="tpl-h" className="space-y-2">
        <h2 id="tpl-h" className="text-lg font-semibold">
          Templates
        </h2>
        {templates.isPending && <Loading what="templates" />}
        {templates.isError && <Failed what="templates" />}
        {templates.data && log.data && (
          <Table
            label="Email templates"
            head={[
              "Email",
              "Sent when",
              "Goes to",
              "Sent (7 d)",
              "Failed (7 d)",
              "",
            ]}
          >
            {templates.data.map((t) => {
              const k = log.data.kinds.find((x) => x.kind === t.kind);
              return (
                <tr key={t.kind} className="align-top">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {t.title}
                  </th>
                  <td className="px-4 py-3 text-muted">{t.when}</td>
                  <td className="px-4 py-3 text-muted">{t.audience}</td>
                  <td className="px-4 py-3">{num(k?.sent_7d ?? 0)}</td>
                  <td
                    className={`px-4 py-3 ${k && k.failed_7d > 0 ? "font-medium text-red-700" : ""}`}
                  >
                    {num(k?.failed_7d ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => setPreview(t.kind)}
                      aria-label={`Preview ${t.title}`}
                    >
                      Preview
                    </button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      {preview && (
        <section aria-labelledby="pv-h" className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pv-h" className="text-lg font-semibold">
              Preview: {templates.data?.find((t) => t.kind === preview)?.title}
            </h2>
            <div className="flex gap-2">
              <button
                className={
                  view === "html"
                    ? "btn-primary btn-sm"
                    : "btn-secondary btn-sm"
                }
                aria-pressed={view === "html"}
                onClick={() => setView("html")}
              >
                Email
              </button>
              <button
                className={
                  view === "text"
                    ? "btn-primary btn-sm"
                    : "btn-secondary btn-sm"
                }
                aria-pressed={view === "text"}
                onClick={() => setView("text")}
              >
                Plain text
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
          </div>
          {p.isPending && <Loading what="the preview" />}
          {p.isError && <Failed what="the preview" />}
          {p.data && (
            <>
              <p className="text-sm">
                <span className="text-muted">Subject: </span>
                <strong>{p.data.subject}</strong>
              </p>
              <p className="text-xs text-muted">
                Sample data, not a real person.
              </p>
              {view === "html" ? (
                // The email is shown in a sandboxed frame: it cannot run scripts or reach this page.
                <iframe
                  title={`Preview of ${p.data.subject}`}
                  sandbox=""
                  srcDoc={p.data.html}
                  className="h-[640px] w-full rounded-xl border border-line bg-white"
                />
              ) : (
                <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-4 text-sm">
                  {p.data.text}
                </pre>
              )}
            </>
          )}
        </section>
      )}

      <section aria-labelledby="elog-h" className="space-y-2">
        <h2 id="elog-h" className="text-lg font-semibold">
          Delivery log
        </h2>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="mr-2 text-muted">Email</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="input !min-h-[40px] !py-1.5"
            >
              <option value="">All</option>
              {templates.data?.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mr-2 text-muted">Result</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input !min-h-[40px] !py-1.5"
            >
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="sr-only">Search by address</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Email address"
              className="input w-56 !min-h-[40px]"
            />
          </label>
        </div>
        {log.isPending && <Loading what="the log" />}
        {log.isError && <Failed what="the log" />}
        {log.data && log.data.items.length === 0 && (
          <Empty>No emails match.</Empty>
        )}
        {log.data && log.data.items.length > 0 && (
          <Table label="Emails sent" head={["When", "Email", "To", "Result"]}>
            {log.data.items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 text-muted">{when(e.at)}</td>
                <td className="px-4 py-3">
                  {templates.data?.find((t) => t.kind === e.kind)?.title ??
                    e.kind}
                </td>
                <td className="px-4 py-3">{e.to}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${e.status === "failed" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}
                  >
                    {e.status === "failed" ? "Failed" : "Sent"}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
