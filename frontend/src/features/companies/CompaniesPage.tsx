import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useCompanies, useCreateCompany, useNotes } from "../../api/hooks";
import { isActive } from "../../api/polling";
import type { CompanyInput } from "../../api/types";
import { CompanyForm } from "./CompanyForm";
import { daysSince } from "./ResearchStatus";
import { LoadingRows } from "../../ui/Loading";

function statusText(status: string | null, last: string | null): string {
  if (isActive(status)) return "Researching…";
  if (status === "failed") return "Research failed";
  const age = daysSince(last);
  if (age === null) return "Not researched";
  return age === 0
    ? "Researched today"
    : `Researched ${age} day${age === 1 ? "" : "s"} ago`;
}

export function CompaniesPage() {
  const companies = useCompanies();
  const notes = useNotes();
  const create = useCreateCompany();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  // Reuse one idempotency key while the payload is unchanged, so a retried save cannot start a
  // second research job. A changed payload gets a new key.
  const last = useRef<{ payload: string; key: string } | null>(null);

  const submit = (input: CompanyInput) => {
    const payload = JSON.stringify(input);
    if (last.current?.payload !== payload) {
      last.current = { payload, key: crypto.randomUUID() };
    }
    create.mutate(
      { input, key: last.current.key },
      { onSuccess: (res) => navigate(`/companies/${res.company.id}`) },
    );
  };

  const items = companies.data ?? [];
  return (
    <main className="page-narrow">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Companies</h1>
        {!adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            Add a company
          </button>
        )}
      </div>

      {adding && (
        <section aria-labelledby="add-h" className="card">
          <h2 id="add-h" className="mb-3 text-lg font-semibold">
            Add a company
          </h2>
          <p className="mb-3 text-sm text-muted">
            Add the company that will be interviewing you, not an employer you
            have worked for. The app reads the links you give and searches the
            web for what the company does and how it works, then writes a brief
            with a source for every fact. It takes about a minute and keeps
            going if you leave.
          </p>
          <CompanyForm
            defaultRole={notes.data?.role ?? ""}
            submitLabel="Save and research"
            pending={create.isPending}
            error={create.isError ? create.error.message : null}
            onSubmit={submit}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}

      {companies.isPending && <LoadingRows />}
      {companies.isError && (
        <p>Couldn&apos;t load your companies. Reload to try again.</p>
      )}
      {companies.isSuccess && items.length === 0 && !adding && (
        <p className="text-muted">
          No companies yet. Add the company you&apos;re interviewing with to get
          a researched brief on what they do and how they work, before your
          interview.
        </p>
      )}
      <ul className="list-card">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-3">
            <Link
              to={`/companies/${c.id}`}
              className="font-medium text-accent-dark underline"
            >
              {c.name}
            </Link>
            <span className="text-sm text-muted">
              {statusText(c.job_status, c.last_researched_at)}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
