import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { useMe, useSaveTour } from "../../api/hooks";
import { Tour } from "./Tour";
import { TOUR_STEPS } from "./steps";

const TourContext = createContext<{ start: () => void }>({
  start: () => undefined,
});

/** Ask for the tour from anywhere (the account menu, the Help page). */
export const useTour = () => useContext(TourContext);

/** Shows the tour once, the first time the dashboard opens, and again whenever it is asked for.
 *  Finishing or skipping is remembered on the account, so it does not come back on other devices. */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const save = useSaveTour();
  const [active, setActive] = useState(false);
  const [offered, setOffered] = useState(false);

  // Only an account the server says has not had it (an explicit false), and only on the dashboard,
  // so it never interrupts what someone is in the middle of.
  useEffect(() => {
    if (!offered && me?.tour_done === false && pathname === "/dashboard") {
      setOffered(true);
      setActive(true);
    }
  }, [me?.tour_done, pathname, offered]);

  const close = () => {
    setActive(false);
    setOffered(true);
    save.mutate(true); // finished or skipped, it is not shown by itself again
  };

  return (
    <TourContext.Provider value={{ start: () => setActive(true) }}>
      {children}
      {active && <Tour steps={TOUR_STEPS} onClose={close} />}
    </TourContext.Provider>
  );
}
