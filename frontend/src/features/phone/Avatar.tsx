/** A round badge with the person's initials. */
export function initialsOf(name: string | null | undefined, email?: string) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email?.[0] ?? "?").toUpperCase();
}

export function Avatar({
  name,
  email,
  size = "md",
}: {
  name?: string | null;
  email?: string;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-dark font-semibold text-surface ${
        size === "lg" ? "h-16 w-16 text-xl" : "h-11 w-11 text-sm"
      }`}
    >
      {initialsOf(name, email)}
    </span>
  );
}
