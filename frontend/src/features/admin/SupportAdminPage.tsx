import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAdminSupport, useAdminTicket, useSupportActions } from "./api";
import {
  Badge,
  Empty,
  Failed,
  Loading,
  PageHead,
  SearchField,
  Tabs,
  when,
} from "./ui";

const TONE: Record<string, "default" | "good" | "warn" | "bad"> = {
  open: "warn",
  answered: "default",
  resolved: "good",
  closed: "default",
};
const LABEL: Record<string, string> = {
  open: "Needs a reply",
  answered: "Answered",
  resolved: "Resolved",
  closed: "Closed",
};

type Filter = "" | "open" | "answered" | "resolved" | "closed";

function Thread({ id }: { id: string }) {
  const q = useAdminTicket(id);
  const act = useSupportActions(id);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");

  if (q.isPending) return <Loading what="the conversation" />;
  if (q.isError || !q.data) return <Failed what="the conversation" />;
  const t = q.data;
  const closed = t.status === "resolved" || t.status === "closed";
  const sending = act.reply.isPending || act.note.isPending;
  const error = act.reply.error ?? act.note.error ?? act.status.error;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || sending) return;
    (mode === "reply" ? act.reply : act.note).mutate(v, {
      onSuccess: () => setText(""),
    });
  };

  return (
    <section
      aria-label="Conversation"
      className="space-y-4 rounded-3xl bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold tracking-tight">
            {t.subject}
          </h2>
          <p className="mt-1 text-sm text-muted">
            <Link to={`/admin/users/${t.user_id}`} className="underline">
              {t.user_name ? `${t.user_name} · ` : ""}
              {t.user_email}
            </Link>{" "}
            · joined {when(t.user_joined)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t.category}
            {t.context?.platform ? ` · ${t.context.platform}` : ""}
            {t.context?.app_version ? ` · v${t.context.app_version}` : ""}
            {t.context?.page ? ` · from ${t.context.page}` : ""}
          </p>
        </div>
        <Badge tone={TONE[t.status] ?? "default"} dot>
          {LABEL[t.status] ?? t.status}
        </Badge>
      </div>

      <ol className="space-y-3" aria-label="Messages">
        {t.thread.map((m) => (
          <li
            key={m.id}
            className={`max-w-[94%] rounded-2xl p-3.5 text-sm ${
              m.kind === "note"
                ? "border border-amber-200 bg-amber-50"
                : m.kind === "staff"
                  ? "ml-auto bg-accent-soft"
                  : "bg-panel"
            }`}
          >
            <p className="text-xs font-medium text-muted">
              {m.kind === "note" ? "Private note · " : ""}
              {m.author} · {when(m.created_at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={send} className="space-y-3">
        <div
          role="group"
          aria-label="What to send"
          className="inline-flex gap-1 rounded-full bg-panel p-1"
        >
          {(
            [
              ["reply", "Reply to the person"],
              ["note", "Private note"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
              className={`min-h-[36px] rounded-full px-3.5 text-sm ${
                mode === k
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label htmlFor="sup-admin-text" className="sr-only">
          {mode === "reply" ? "Your reply" : "Your note"}
        </label>
        <textarea
          id="sup-admin-text"
          className="input min-h-[120px] w-full"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            mode === "reply"
              ? "They get this here and by email."
              : "Only the team sees this."
          }
        />
        {error && (
          <p role="alert" className="notice-error">
            {error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={!text.trim() || sending}
          >
            {sending
              ? "Sending…"
              : mode === "reply"
                ? "Send reply"
                : "Save note"}
          </button>
          {closed ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={act.status.isPending}
              onClick={() => act.status.mutate("open")}
            >
              Reopen
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={act.status.isPending}
                onClick={() => act.status.mutate("resolved")}
              >
                Mark resolved
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={act.status.isPending}
                onClick={() => act.status.mutate("closed")}
              >
                Close
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}

/** The support inbox: what people wrote, newest and unanswered first, with the whole conversation
 *  beside it to answer from. */
export function SupportAdminPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Filter>("");
  const [search, setSearch] = useState("");
  const q = useAdminSupport(status, search);

  const counts = q.data?.counts;
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHead
        title="Support"
        intro="What people have written to us from any app. Replies reach them here and by email; private notes stay with the team."
        right={
          <SearchField
            id="support-search"
            label="Search support"
            placeholder="Subject or email"
            value={search}
            onChange={setSearch}
          />
        }
      />
      <Tabs<Filter>
        label="Status"
        value={status}
        onChange={(v) => {
          setStatus(v);
          if (id) navigate("/admin/support");
        }}
        items={[
          { id: "", label: "All" },
          { id: "open", label: "Needs a reply", count: counts?.open },
          { id: "answered", label: "Answered", count: counts?.answered },
          { id: "resolved", label: "Resolved", count: counts?.resolved },
          { id: "closed", label: "Closed", count: counts?.closed },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)] xl:items-start">
        <section
          aria-label="Conversations"
          className={`space-y-2 ${id ? "hidden xl:block" : ""}`}
        >
          {q.isPending && <Loading what="support" />}
          {q.isError && <Failed what="support" />}
          {q.data && items.length === 0 && (
            <Empty>
              Nothing here. Messages from people appear as they write.
            </Empty>
          )}
          <ul className="space-y-2">
            {items.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/admin/support/${t.id}`}
                  aria-current={t.id === id ? "page" : undefined}
                  className={`block rounded-2xl p-3.5 shadow-card transition-colors ${
                    t.id === id ? "bg-accent-soft" : "bg-surface hover:bg-panel"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium">
                      {t.unread && (
                        <span
                          role="img"
                          aria-label="Unread"
                          className="mr-2 inline-block h-2 w-2 rounded-full bg-accent"
                        />
                      )}
                      {t.subject}
                    </span>
                    <Badge tone={TONE[t.status] ?? "default"} dot>
                      {LABEL[t.status] ?? t.status}
                    </Badge>
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted">
                    {t.last_message}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {t.user_email}
                    {t.platform ? ` · ${t.platform}` : ""} ·{" "}
                    {when(t.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        {id ? (
          <div>
            <Link
              to="/admin/support"
              className="mb-3 inline-block text-sm text-accent-dark underline xl:hidden"
            >
              All conversations
            </Link>
            <Thread key={id} id={id} />
          </div>
        ) : (
          <div className="hidden xl:block">
            <Empty>Choose a conversation to read it and reply.</Empty>
          </div>
        )}
      </div>
    </div>
  );
}
