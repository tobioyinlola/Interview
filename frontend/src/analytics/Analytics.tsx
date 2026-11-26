import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import type { Me } from "../api/types";
import { cleanRoute, setOptOut, setScreen, startAnalytics } from "./index";

/** Starts the usage statistics and reports each screen as the person moves between them. Renders
 *  nothing. The back office is not measured: it is staff, not customers. */
export function Analytics() {
  const { pathname } = useLocation();
  // the person's own setting, read from the account if it is already loaded (never fetched here, so
  // the public pages do not make a request just for this)
  const me = useQuery<Me | null>({ queryKey: ["me"], enabled: false });
  useEffect(() => startAnalytics(), []);
  useEffect(() => {
    if (me.data) setOptOut(me.data.analytics_opt_out === true);
  }, [me.data]);
  useEffect(() => {
    setScreen(pathname.startsWith("/admin") ? null : cleanRoute(pathname));
  }, [pathname]);
  return null;
}
