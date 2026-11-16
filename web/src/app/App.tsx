import { Navigate, Route, Routes } from "react-router-dom";

import { SettingsPage } from "../features/account/SettingsPage";
import { AuthGuard } from "../features/auth/AuthGuard";
import { SignInForm } from "../features/auth/SignInForm";
import { VerifyPage } from "../features/auth/VerifyPage";
import { CompaniesPage } from "../features/companies/CompaniesPage";
import { CompanyPage } from "../features/companies/CompanyPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LiveSessionPage } from "../features/session/LiveSessionPage";
import { ReviewPage } from "../features/session/ReviewPage";
import { SessionsPage } from "../features/session/SessionsPage";
import { SessionSetupPage } from "../features/session/SessionSetupPage";
import { NotesPage } from "../features/notes/NotesPage";
import { BrowserNotice } from "./BrowserNotice";
import { currentEnv, isSupported } from "./browserSupport";
import { Layout } from "./Layout";

export function App() {
  if (!isSupported(currentEnv())) return <BrowserNotice />;
  return (
    <Routes>
      <Route path="/login" element={<SignInForm />} />
      <Route path="/login/verify" element={<VerifyPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyPage />} />
          <Route path="/session/new" element={<SessionSetupPage />} />
          <Route path="/session/:id" element={<LiveSessionPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<ReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
