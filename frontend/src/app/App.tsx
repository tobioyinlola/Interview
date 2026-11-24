import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { SettingsPage } from "../features/account/SettingsPage";
import { AuthGuard } from "../features/auth/AuthGuard";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { SignInForm } from "../features/auth/SignInForm";
import { SignUpForm } from "../features/auth/SignUpForm";
import { VerifyPage } from "../features/auth/VerifyPage";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { CompanyPage } from "../features/companies/CompanyPage";
import { ApplicationPage } from "../features/autoapply/ApplicationPage";
import { ApplicationsPage } from "../features/autoapply/ApplicationsPage";
import { AutoApplyPage } from "../features/autoapply/AutoApplyPage";
import { StartupsPage } from "../features/startups/StartupsPage";
import { SetupPage } from "../features/autoapply/SetupPage";
import { PrivacyPage, TermsPage } from "../features/legal/LegalPages";
import { useMe } from "../api/hooks";
import { LandingPage } from "../features/landing/LandingPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { SessionsPage } from "../features/session/SessionsPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { BrowserNotice } from "./BrowserNotice";
import { currentEnv, isSupported } from "./browserSupport";
import { Layout } from "./Layout";
import { AppReturnPage } from "../features/auth/AppReturnPage";
import { VerifiedToast } from "../features/auth/VerifiedToast";
import { Splash } from "../features/splash/Splash";
import { Welcome, welcomeSeen } from "../features/phone/Welcome";
import { PhoneHome } from "../features/phone/PhoneHome";
import { PhoneLayout } from "../features/phone/PhoneLayout";
import { ProfilePage } from "../features/phone/ProfilePage";
import { NativeLinks } from "./NativeLinks";
import { OfflineBanner } from "./OfflineBanner";
import { confirmReady } from "./liveUpdate";
import { MobileLiveNotice } from "./MobileLiveNotice";
import { isMobileApp, isNativeApp } from "./native";
import { Loading } from "../ui/Loading";

/** Pages most people never open (the back office, live interviews, help) load only when visited, so
 *  the app's first download, and its opening animation, are not held up by them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyPage<M extends Record<string, ComponentType<any>>>(
  load: () => Promise<M>,
  name: keyof M,
) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const HelpPage = lazyPage(
  () => import("../features/help/HelpPage"),
  "HelpPage",
);
const ReferralPage = lazyPage(
  () => import("../features/referral/ReferralPage"),
  "ReferralPage",
);
const StartupsAdminPage = lazyPage(
  () => import("../features/admin/StartupsAdminPage"),
  "StartupsAdminPage",
);
const AutoApplyAdminPage = lazyPage(
  () => import("../features/admin/AutoApplyAdminPage"),
  "AutoApplyAdminPage",
);
const ActivityPage = lazyPage(
  () => import("../features/admin/ActivityPage"),
  "ActivityPage",
);
const AdminLayout = lazyPage(
  () => import("../features/admin/AdminLayout"),
  "AdminLayout",
);
const EmailsAdminPage = lazyPage(
  () => import("../features/admin/EmailsAdminPage"),
  "EmailsAdminPage",
);
const MarketingPage = lazyPage(
  () => import("../features/admin/MarketingPage"),
  "MarketingPage",
);
const OverviewPage = lazyPage(
  () => import("../features/admin/OverviewPage"),
  "OverviewPage",
);
const QualityPage = lazyPage(
  () => import("../features/admin/QualityPage"),
  "QualityPage",
);
const ReferralsAdminPage = lazyPage(
  () => import("../features/admin/ReferralsAdminPage"),
  "ReferralsAdminPage",
);
const StaffLoginPage = lazyPage(
  () => import("../features/admin/StaffLoginPage"),
  "StaffLoginPage",
);
const StaffVerifyPage = lazyPage(
  () => import("../features/admin/StaffVerifyPage"),
  "StaffVerifyPage",
);
const UsagePage = lazyPage(
  () => import("../features/admin/UsagePage"),
  "UsagePage",
);
const UserPage = lazyPage(
  () => import("../features/admin/UserPage"),
  "UserPage",
);
const UsersPage = lazyPage(
  () => import("../features/admin/UsersPage"),
  "UsersPage",
);
const LiveSessionPage = lazyPage(
  () => import("../features/session/LiveSessionPage"),
  "LiveSessionPage",
);
const ReviewPage = lazyPage(
  () => import("../features/session/ReviewPage"),
  "ReviewPage",
);
const SessionSetupPage = lazyPage(
  () => import("../features/session/SessionSetupPage"),
  "SessionSetupPage",
);

/** The landing page is for signed-out visitors; signed-in users go straight to the dashboard. */
function Home() {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  if (me) return <Navigate to="/dashboard" replace />;
  // The installed apps are not a website: they open straight on sign-in, not the marketing page.
  if (isMobileApp() && !welcomeSeen())
    return <Navigate to="/welcome" replace />;
  return isNativeApp() ? <Navigate to="/login" replace /> : <LandingPage />;
}

/** The website needs desktop Chromium (tab audio capture); the phone app is allowed in too, without
 *  live interviews. The landing and legal pages need neither. */
function SupportedBrowser() {
  return isSupported(currentEnv()) || isMobileApp() ? (
    <Outlet />
  ) : (
    <BrowserNotice />
  );
}

export function App() {
  // a new copy of the interface that gets this far is a good one; without this the phone app goes
  // back to the last good copy (see liveUpdate.ts)
  useEffect(() => {
    const t = setTimeout(() => void confirmReady(), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <NativeLinks />
      <OfflineBanner />
      <VerifiedToast />
      <AppRoutes />
      <Splash />
    </>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Pages opened from an email must work in any browser, a phone's included. */}
        <Route path="/login/verify" element={<VerifyPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/admin/login" element={<StaffLoginPage />} />
        <Route path="/admin/verify" element={<StaffVerifyPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="referrals" element={<ReferralsAdminPage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="quality" element={<QualityPage />} />
          <Route path="emails" element={<EmailsAdminPage />} />
          <Route path="auto-apply" element={<AutoApplyAdminPage />} />
          <Route path="startups" element={<StartupsAdminPage />} />
          <Route path="usage" element={<UsagePage />} />
        </Route>
        <Route element={<SupportedBrowser />}>
          <Route path="/login" element={<SignInForm />} />
          <Route path="/signup" element={<SignUpForm />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/app" element={<AppReturnPage />} />
          <Route element={<AuthGuard />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={isMobileApp() ? <PhoneLayout /> : <Layout />}>
              <Route
                path="/dashboard"
                element={isMobileApp() ? <PhoneHome /> : <DashboardPage />}
              />
              <Route path="/me" element={<ProfilePage />} />
              <Route
                path="/notes"
                element={<Navigate to="/settings/cv" replace />}
              />
              <Route path="/companies" element={<CompaniesPage />} />
              <Route path="/companies/:id" element={<CompanyPage />} />
              <Route
                path="/session/new"
                element={
                  isMobileApp() ? <MobileLiveNotice /> : <SessionSetupPage />
                }
              />
              <Route
                path="/session/:id"
                element={
                  isMobileApp() ? <MobileLiveNotice /> : <LiveSessionPage />
                }
              />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/sessions/:id" element={<ReviewPage />} />
              <Route path="/auto-apply" element={<AutoApplyPage />} />
              <Route path="/auto-apply/setup" element={<SetupPage />} />
              <Route
                path="/auto-apply/applications"
                element={<ApplicationsPage />}
              />
              <Route
                path="/auto-apply/applications/:id"
                element={<ApplicationPage />}
              />
              <Route path="/auto-apply/startups" element={<StartupsPage />} />
              <Route
                path="/startups"
                element={<Navigate to="/auto-apply/startups" replace />}
              />
              <Route path="/referrals" element={<ReferralPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route
                path="/settings"
                element={<Navigate to="/settings/profile" replace />}
              />
              <Route path="/settings/:tab" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
