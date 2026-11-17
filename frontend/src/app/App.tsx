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
import { UsagePage } from "../features/admin/UsagePage";
import { PrivacyPage, TermsPage } from "../features/legal/LegalPages";
import { useMe } from "../api/hooks";
import { LandingPage } from "../features/landing/LandingPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LiveSessionPage } from "../features/session/LiveSessionPage";
import { ReviewPage } from "../features/session/ReviewPage";
import { SessionsPage } from "../features/session/SessionsPage";
import { SessionSetupPage } from "../features/session/SessionSetupPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { NotesPage } from "../features/notes/NotesPage";
import { BrowserNotice } from "./BrowserNotice";
import { currentEnv, isSupported } from "./browserSupport";
import { Layout } from "./Layout";

/** The landing page is for signed-out visitors; signed-in users go straight to the dashboard. */
function Home() {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  return me ? <Navigate to="/dashboard" replace /> : <LandingPage />;
}

/** The app needs desktop Chromium (tab audio capture). The landing and legal pages do not. */
function SupportedBrowser() {
  return isSupported(currentEnv()) ? <Outlet /> : <BrowserNotice />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route element={<SupportedBrowser />}>
        <Route path="/login" element={<SignInForm />} />
        <Route path="/signup" element={<SignUpForm />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login/verify" element={<VerifyPage />} />
        <Route element={<AuthGuard />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyPage />} />
            <Route path="/session/new" element={<SessionSetupPage />} />
            <Route path="/session/:id" element={<LiveSessionPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:id" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin/usage" element={<UsagePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
