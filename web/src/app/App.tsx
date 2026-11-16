import { Navigate, Route, Routes } from "react-router-dom";

import { SettingsPage } from "../features/account/SettingsPage";
import { AuthGuard } from "../features/auth/AuthGuard";
import { SignInForm } from "../features/auth/SignInForm";
import { VerifyPage } from "../features/auth/VerifyPage";
import { NotesPage } from "../features/notes/NotesPage";
import { BrowserNotice } from "./BrowserNotice";
import { currentEnv, isSupported } from "./browserSupport";
import { Layout } from "./Layout";

function Placeholder({ name }: { name: string }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="mt-2 text-gray-600">Coming in a later milestone.</p>
    </main>
  );
}

export function App() {
  if (!isSupported(currentEnv())) return <BrowserNotice />;
  return (
    <Routes>
      <Route path="/login" element={<SignInForm />} />
      <Route path="/login/verify" element={<VerifyPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Placeholder name="Dashboard" />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route
            path="/companies/*"
            element={<Placeholder name="Companies" />}
          />
          <Route
            path="/session/new"
            element={<Placeholder name="Session setup" />}
          />
          <Route
            path="/session/:id"
            element={<Placeholder name="Live session" />}
          />
          <Route path="/sessions/:id" element={<Placeholder name="Review" />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
