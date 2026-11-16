import { Navigate, Route, Routes } from 'react-router-dom'

import { BrowserNotice } from './BrowserNotice'
import { currentEnv, isSupported } from './browserSupport'

function Placeholder({ name }: { name: string }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="mt-2 text-gray-600">Coming in a later milestone.</p>
    </main>
  )
}

export function App() {
  if (!isSupported(currentEnv())) return <BrowserNotice />
  return (
    <Routes>
      <Route path="/" element={<Placeholder name="Dashboard" />} />
      <Route path="/login" element={<Placeholder name="Sign in" />} />
      <Route path="/notes" element={<Placeholder name="Notes" />} />
      <Route path="/companies/*" element={<Placeholder name="Companies" />} />
      <Route path="/session/new" element={<Placeholder name="Session setup" />} />
      <Route path="/session/:id" element={<Placeholder name="Live session" />} />
      <Route path="/sessions/:id" element={<Placeholder name="Review" />} />
      <Route path="/settings" element={<Placeholder name="Settings" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
