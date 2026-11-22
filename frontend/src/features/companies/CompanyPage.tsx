import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  useCompany,
  useEditBrief,
  useDeleteCompany,
  usePasteSource,
  useRemoveSource,
  useRerunResearch,
  useUpdateCompany,
} from "../../api/hooks";
import { ApiError } from "../../api/client";
import { BriefView } from "./BriefView";
import { CompanyForm } from "./CompanyForm";
import { PasteTextDialog } from "./PasteTextDialog";
import { ResearchStatus } from "./ResearchStatus";
import { SourceList } from "./SourceList";
import { Loading } from "../../ui/Loading";

export function CompanyPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useCompany(id);
  const update = useUpdateCompany(id);
  const del = useDeleteCompany(id);
  const rerun = useRerunResearch(id);
  const paste = usePasteSource(id);
  const remove = useRemoveSource(id);
  const editBrief = useEditBrief(id);

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pasteTitle, setPasteTitle] = useState<string | null>(null);

  if (isPending) return <Loading />;
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-8">
        <p>
          {missing
            ? "That company was not found."
            : "Couldn't load this company."}
        </p>
        <Link to="/companies" className="text-accent-dark underline">
          Back to companies
        </Link>
      </main>
    );
  }

  const { company, brief, sources, job } = data;
  return (
    <main className="page-narrow">
      <div>
        <Link to="/companies" className="text-sm text-accent-dark underline">
          ← Companies
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {company.name}
        </h1>
        {company.role && <p className="text-muted">{company.role}</p>}
      </div>

      <ResearchStatus
        job={job}
        lastResearchedAt={company.last_researched_at}
        researching={rerun.isPending}
        rerunError={rerun.isError ? rerun.error.message : null}
        onResearch={() => rerun.mutate()}
      />

      {saved && (
        <p
          role="status"
          className="rounded-xl bg-green-50 p-3 text-sm text-green-900"
        >
          Saved. Press <strong>Research again</strong> to use these changes.
        </p>
      )}

      {editing ? (
        <section aria-labelledby="edit-h" className="card">
          <h2 id="edit-h" className="mb-3 text-lg font-semibold">
            Edit company
          </h2>
          <CompanyForm
            initial={{
              name: company.name,
              website_url: company.website_url,
              job_posting_url: company.job_posting_url,
              extra_links: company.extra_links,
              role: company.role,
              known_text: company.known_text,
            }}
            submitLabel="Save changes"
            pending={update.isPending}
            error={update.isError ? update.error.message : null}
            onSubmit={(input) =>
              update.mutate(input, {
                onSuccess: () => {
                  setEditing(false);
                  setSaved(true);
                },
              })
            }
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : (
        <button
          className="btn-secondary"
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
        >
          Edit company details
        </button>
      )}

      <section aria-labelledby="brief-h" className="card space-y-3">
        <h2 id="brief-h" className="text-xl font-semibold">
          Company brief
        </h2>
        {brief ? (
          <BriefView
            brief={brief}
            sources={sources}
            editing={{
              onSave: (edits) => editBrief.mutate(edits),
              pending: editBrief.isPending,
              error: editBrief.isError ? editBrief.error.message : null,
            }}
          />
        ) : (
          <p className="text-muted">
            {job?.status === "failed"
              ? "No brief yet. Check the sources below, paste text for any page that could not be read, then research again."
              : "The brief will appear here when research finishes."}
          </p>
        )}
      </section>

      <section aria-labelledby="src-h" className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="src-h" className="text-xl font-semibold">
            Sources
          </h2>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPasteTitle("")}
          >
            Paste text
          </button>
        </div>
        <SourceList
          sources={sources}
          onPaste={(title) => setPasteTitle(title)}
          onRemove={(sid) => remove.mutate(sid)}
          removingId={remove.isPending ? remove.variables : null}
        />
      </section>

      {pasteTitle !== null && (
        <PasteTextDialog
          initialTitle={pasteTitle}
          pending={paste.isPending}
          error={paste.isError ? paste.error.message : null}
          onSave={(input) =>
            paste.mutate(input, { onSuccess: () => setPasteTitle(null) })
          }
          onClose={() => setPasteTitle(null)}
        />
      )}

      <section aria-labelledby="del-h" className="pt-6">
        <h2 id="del-h" className="sr-only">
          Delete company
        </h2>
        {confirmDelete ? (
          <div
            role="alertdialog"
            aria-label="Confirm deletion"
            className="notice-error space-y-2"
          >
            <p>
              Delete {company.name} and its brief and sources? Past sessions are
              kept.
            </p>
            <div className="flex gap-2">
              <button
                className="btn-danger"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(undefined, {
                    onSuccess: () => navigate("/companies"),
                  })
                }
              >
                Yes, delete
              </button>
              <button
                className="btn-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
            {del.isError && (
              <p role="alert" className="text-sm text-red-800">
                {del.error.message}
              </p>
            )}
          </div>
        ) : (
          <button
            className="btn-danger-outline"
            onClick={() => setConfirmDelete(true)}
          >
            Delete this company
          </button>
        )}
      </section>
    </main>
  );
}
