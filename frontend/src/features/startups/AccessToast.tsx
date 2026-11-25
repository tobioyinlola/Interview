import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useMe } from "../../api/hooks";

const KEY = "im-outreach-access";

const last = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (v: string): void => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* the notice is a courtesy */
  }
};

/** Says so, once, when the operator lets this person into startup outreach. While a request is
 *  waiting it checks again every half minute, so it shows up without a reload. */
export function AccessToast() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const access = me?.outreach_access ?? null;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!access) return;
    const before = last();
    if (access === "active" && before && before !== "active") setShown(true);
    remember(access);
  }, [access]);

  useEffect(() => {
    if (access !== "requested") return;
    const t = setInterval(
      () => void qc.invalidateQueries({ queryKey: ["me"] }),
      30_000,
    );
    return () => clearInterval(t);
  }, [access, qc]);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-surface shadow-lift"
    >
      <CircleCheck
        className="h-6 w-6 shrink-0 text-emerald-300"
        aria-hidden="true"
      />
      <span className="flex-1 text-sm">
        <strong className="block font-semibold">
          Startup outreach is now open to you
        </strong>
        Connect your Gmail to start.{" "}
        <Link
          to="/startups"
          className="font-medium underline"
          onClick={() => setShown(false)}
        >
          Open it
        </Link>
      </span>
      <button
        type="button"
        onClick={() => setShown(false)}
        className="min-h-[44px] px-2 text-sm font-medium text-surface/80"
      >
        OK
      </button>
    </div>
  );
}
