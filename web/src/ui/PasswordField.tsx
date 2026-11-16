import { useId, useState } from "react";

import { EyeIcon, EyeOffIcon } from "../app/icons";

/** A password input with a button that reveals what was typed. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  describedBy?: string;
  invalid?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={shown ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="input w-full pr-11"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-ink"
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
