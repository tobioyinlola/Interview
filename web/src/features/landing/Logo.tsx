/** InterviewMeet mark: a speech bubble holding sound bars (a conversation, being listened to). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#7B47F3" />
      <path
        d="M8 9.5A2.5 2.5 0 0 1 10.5 7h11A2.5 2.5 0 0 1 24 9.5v8a2.5 2.5 0 0 1-2.5 2.5H15l-4.2 3.6c-.5.4-1.3.1-1.3-.6V20A2.5 2.5 0 0 1 8 17.5z"
        fill="#fff"
      />
      <g fill="#7B47F3">
        <rect x="12" y="11.5" width="1.8" height="5" rx=".9" />
        <rect x="15.1" y="10" width="1.8" height="8" rx=".9" />
        <rect x="18.2" y="12.5" width="1.8" height="3" rx=".9" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">
        InterviewMeet
      </span>
    </span>
  );
}
