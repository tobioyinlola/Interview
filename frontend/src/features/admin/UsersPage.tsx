import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAdminUsers } from "./api";
import { Empty, Failed, Loading, PageHead, Table, num, when } from "./ui";

const PAGE = 25;
const SORTS: [string, string][] = [
  ["newest", "Newest first"],
  ["active", "Most recently active"],
  ["sessions", "Most interviews"],
  ["oldest", "Oldest first"],
];

/** Everyone on the platform: search by name or email, sort, and open one account. */
export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "newest";
  const offset = Number(params.get("offset") ?? "0") || 0;
  const [draft, setDraft] = useState(q);
  const users = useAdminUsers({ q, sort, offset, limit: PAGE });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    setParams(next, { replace: true });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    set({ q: draft.trim(), offset: null });
  };

  const total = users.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <div className="space-y-4">
      <PageHead
        title="Users"
        intro="Everyone who has an account. Open someone to see their activity and give them free interviews. You see what people did, never what they wrote or said."
      />
      <div className="flex flex-wrap items-end gap-3">
        <form
          onSubmit={search}
          className="flex gap-2"
          role="search"
          aria-label="Find a person"
        >
          <label className="sr-only" htmlFor="user-q">
            Search by name or email
          </label>
          <input
            id="user-q"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search name or email"
            className="input w-64 !min-h-[40px]"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
        <label className="text-sm">
          <span className="mr-2 text-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => set({ sort: e.target.value, offset: null })}
            className="input !min-h-[40px] !py-1.5"
          >
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {users.isPending && <Loading what="people" />}
      {users.isError && <Failed what="people" />}
      {users.data && users.data.items.length === 0 && (
        <Empty>
          {q ? `Nobody matches “${q}”.` : "There is nobody here yet."}
        </Empty>
      )}
      {users.data && users.data.items.length > 0 && (
        <>
          <Table
            label="People"
            head={[
              "Person",
              "Joined",
              "Last active",
              "Interviews",
              "CV",
              "Credits",
              "Came from",
            ]}
          >
            {users.data.items.map((u) => (
              <tr key={u.id} className="align-top">
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="font-medium text-accent-dark underline"
                  >
                    {u.full_name || u.email}
                  </Link>
                  {u.full_name && (
                    <div className="text-xs text-muted">{u.email}</div>
                  )}
                  {u.is_admin && (
                    <span className="mt-1 inline-block rounded-full bg-ink px-2 py-0.5 text-[10px] text-surface">
                      admin
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{when(u.created_at)}</td>
                <td className="px-4 py-3 text-muted">
                  {when(u.last_active_at)}
                </td>
                <td className="px-4 py-3">{num(u.sessions)}</td>
                <td className="px-4 py-3">{u.has_cv ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{num(u.credits_available)}</td>
                <td className="px-4 py-3 text-muted">
                  {[
                    u.signup_method,
                    u.utm_source,
                    u.referred ? "invited" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "–"}
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between text-sm text-muted">
            <span aria-live="polite">
              {from}–{to} of {num(total)}
            </span>
            <span className="flex gap-2">
              <button
                className="btn-secondary btn-sm"
                disabled={offset === 0}
                onClick={() =>
                  set({ offset: String(Math.max(0, offset - PAGE)) })
                }
              >
                Previous
              </button>
              <button
                className="btn-secondary btn-sm"
                disabled={offset + PAGE >= total}
                onClick={() => set({ offset: String(offset + PAGE) })}
              >
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
