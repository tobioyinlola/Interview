import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { platform, appVersion } from "../../analytics/context";
import { Loading } from "../../ui/Loading";
import { formatWhen } from "../review/format";
import {
  useOpenTicket,
  useReply,
  useResolve,
  useTicket,
  useTickets,
} from "./api";
import { lastPage } from "./lastPage";

const CATEGORIES: [string, string][] = [
  ["question", "A question"],
  ["bug", "Something is not working"],
  ["billing", "Billing"],
  ["account", "My account"],
  ["feedback", "An idea or feedback"],
  ["other", "Something else"],
];

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Waiting for us", tone: "bg-amber-50 text-amber-800" },
  answered: { label: "We replied", tone: "bg-accent-soft text-accent-dark" },
  resolved: { label: "Resolved", tone: "bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", tone: "bg-line text-muted" },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.open;
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${s.tone}`}
    >
      {s.label}
    </span>
  );
}

function NewMessage() {
  const open = useOpenTicket();
  const navigate = useNavigate();
  const [category, setCategory] = useState("question");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const ready = subject.trim().length >= 3 && text.trim().length >= 3;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || open.isPending) return;
    open.mutate(
      {
        subject: subject.trim(),
        category: category as "question",
        body: text.trim(),
        context: {
          platform: platform(),
          app_version: appVersion(),
          page: lastPage(),
        },
      },
      { onSuccess: (t) => navigate(`/support/${t.id}`) },
    );
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="text-lg font-semibold">Send us a message</h2>
      <p className="text-sm text-muted">
        Tell us what happened and what you expected. We answer here and by
        email, usually within a day.
      </p>
      <div>
        <label htmlFor="sup-cat" className="block text-sm font-medium">
          What is it about?
        </label>
        <select
          id="sup-cat"
          className="input mt-1 w-full sm:w-80"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sup-subject" className="block text-sm font-medium">
          Subject
        </label>
        <input
          id="sup-subject"
          className="input mt-1 w-full"
          maxLength={160}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A few words"
        />
      </div>
      <div>
        <label htmlFor="sup-body" className="block text-sm font-medium">
          Message
        </label>
        <textarea
          id="sup-body"
          className="input mt-1 min-h-[140px] w-full"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened? What did you expect?"
        />
        <p className="mt-1 text-xs text-muted">
          Please do not include passwords. We see which app and page you wrote
          from, to help us find the problem.
        </p>
      </div>
      {open.isError && (
        <p role="alert" className="notice-error">
          {open.error.message}
        </p>
      )}
      <button
        type="submit"
        className="btn-primary"
        disabled={!ready || open.isPending}
      >
        {open.isPending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

/** Write to the team, and see every conversation with them. */
export function SupportPage() {
  const tickets = useTickets();
  const items = tickets.data?.items ?? [];
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
      <p className="text-sm text-muted">
        Need a hand? Write to the team. You can also look through{" "}
        <Link to="/help" className="text-accent-dark underline">
          Help
        </Link>{" "}
        for quick answers.
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <NewMessage />
        <section aria-labelledby="mine-h" className="card space-y-3">
          <h2 id="mine-h" className="text-lg font-semibold">
            Your conversations
          </h2>
          {tickets.isPending && <Loading label="Loading your conversations" />}
          {tickets.isError && (
            <p role="alert" className="notice-error">
              Your conversations could not be loaded.
            </p>
          )}
          {tickets.data && items.length === 0 && (
            <p className="text-sm text-muted">
              Nothing yet. When you write to us, the conversation appears here.
            </p>
          )}
          <ul className="space-y-2">
            {items.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/support/${t.id}`}
                  className="block rounded-2xl bg-canvas p-3 transition-colors hover:bg-accent-soft"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium">
                      {t.unread && (
                        <span
                          role="img"
                          aria-label="New reply"
                          className="mr-2 inline-block h-2 w-2 rounded-full bg-accent"
                        />
                      )}
                      {t.subject}
                    </span>
                    <StatusChip status={t.status} />
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted">
                    {t.last_message}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {formatWhen(t.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

/** One conversation: what was said, and a box to add to it. */
export function SupportThreadPage() {
  const { id = "" } = useParams();
  const q = useTicket(id);
  const reply = useReply(id);
  const resolve = useResolve(id);
  const [text, setText] = useState("");

  if (q.isPending) return <Loading label="Loading the conversation" />;
  if (q.isError || !q.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          We could not find that conversation.{" "}
          <Link to="/support" className="underline">
            Back to Support
          </Link>
        </p>
      </main>
    );
  const t = q.data;
  const send = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || reply.isPending) return;
    reply.mutate(v, { onSuccess: () => setText("") });
  };

  return (
    <main className="page-narrow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">
            {t.subject}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Started {formatWhen(t.created_at)}
          </p>
        </div>
        <StatusChip status={t.status} />
      </div>

      <ol className="space-y-3" aria-label="Messages">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[92%] rounded-2xl p-4 ${
              m.kind === "user"
                ? "ml-auto bg-accent-soft"
                : "bg-surface shadow-card"
            }`}
          >
            <p className="text-xs font-medium text-muted">
              {m.author} · {formatWhen(m.created_at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {m.body}
            </p>
          </li>
        ))}
      </ol>

      <form onSubmit={send} className="card space-y-3">
        <label htmlFor="sup-reply" className="block text-sm font-medium">
          {t.status === "resolved" || t.status === "closed"
            ? "Not sorted out? Write back and we will reopen it"
            : "Add to this conversation"}
        </label>
        <textarea
          id="sup-reply"
          className="input min-h-[110px] w-full"
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {reply.isError && (
          <p role="alert" className="notice-error">
            {reply.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={!text.trim() || reply.isPending}
          >
            {reply.isPending ? "Sending…" : "Send"}
          </button>
          {t.status !== "resolved" && t.status !== "closed" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              This is sorted out
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
