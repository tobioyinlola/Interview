import { Link, Outlet, useLocation } from "react-router-dom";

import { useMe } from "../../api/hooks";
import { UpdateBanner } from "../../app/UpdateBanner";
import { TourProvider } from "../tour/TourProvider";
import { Avatar } from "./Avatar";
import { FloatingNav } from "./FloatingNav";

/** The frame of the phone app: a quiet top row, the page, and the floating bar. The website's
 *  sidebar, search box and long menus are not used here. */
export function PhoneLayout() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  // the home screen has its own greeting row, with the profile button in it
  const showTop = pathname !== "/dashboard";
  return (
    <TourProvider>
      <div className="phone-app min-h-screen bg-canvas [min-height:100dvh]">
        <UpdateBanner />
        {showTop && (
          <header className="sticky top-0 z-30 flex items-center justify-between bg-canvas/90 px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
            <Link
              to="/dashboard"
              className="text-base font-semibold tracking-tight"
            >
              InterviewMeet
            </Link>
            <Link to="/me" aria-label="Your profile">
              <Avatar name={me?.full_name} email={me?.email} />
            </Link>
          </header>
        )}
        <Outlet />
        <div aria-hidden="true" className="h-32" />
        <FloatingNav autoapply={!!me?.autoapply} />
      </div>
    </TourProvider>
  );
}
