import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAdminUsers } from "./api";
import {
  Avatar,
  Badge,
  Empty,
  Failed,
  Loading,
  PageHead,
  Pager,
  SearchField,
  Table,
  num,
  when,
} from "./ui";

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
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={search}
          className="flex w-full gap-2 sm:w-auto"
          role="search"
          aria-label="Find a person"
        >
          <SearchField
            id="user-q"
            value={draft}
            onChange={setDraft}
            placeholder="Search name or email"
            label="Search by name or email"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
        <label className="inline-flex items-center gap-2 rounded-xl bg-surface px-3 text-sm shadow-card sm:ml-auto">
          <span className="text-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => set({ sort: e.target.value, offset: null })}
            className="min-h-[40px] cursor-pointer bg-transparent py-1.5 pr-1 font-medium focus:outline-none"
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
                  <div className="flex items-center gap-3">
                    <Avatar name={u.full_name || u.email} />
                    <div className="min-w-0 text-left">
                      <Link
                        to={`/admin/users/${u.id}`}
                        className="font-medium text-ink hover:text-accent-dark hover:underline"
                      >
                        {u.full_name || u.email}
                      </Link>
                      {u.full_name && (
                        <div className="truncate text-xs text-muted">
                          {u.email}
                        </div>
                      )}
                      {u.is_admin && <Badge tone="accent">admin</Badge>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{when(u.created_at)}</td>
                <td className="px-4 py-3 text-muted">
                  {when(u.last_active_at)}
                </td>
                <td className="px-4 py-3">{num(u.sessions)}</td>
                <td className="px-4 py-3">
                  {u.has_cv ? (
                    <Badge tone="good">Yes</Badge>
                  ) : (
                    <Badge>No</Badge>
                  )}
                </td>
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
          <Pager
            from={from}
            to={to}
            total={total}
            onPrev={
              offset === 0
                ? null
                : () => set({ offset: String(Math.max(0, offset - PAGE)) })
            }
            onNext={
              offset + PAGE >= total
                ? null
                : () => set({ offset: String(offset + PAGE) })
            }
          />
        </>
      )}
    </div>
  );
}
