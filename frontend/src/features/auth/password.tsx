export const MIN_PASSWORD = 8;

/** A symbol is anything that is not a letter, a digit or a space: ! @ # $ and the like. */
export const hasSymbol = (p: string) => /[^\p{L}\p{N}\s]/u.test(p);
export const passwordOk = (p: string) =>
  p.length >= MIN_PASSWORD && hasSymbol(p);

/** Two plain rules, each ticked off as it is met. */
export function PasswordRules({
  password,
  id,
}: {
  password: string;
  id?: string;
}) {
  const rule = (met: boolean, text: string) => (
    <li className={met ? "text-green-700" : "text-muted"}>
      {met ? "✓ " : ""}
      {text}
    </li>
  );
  return (
    <ul
      id={id}
      className="-mt-2 space-y-0.5 text-xs"
      aria-label="Password rules"
    >
      {rule(
        password.length >= MIN_PASSWORD,
        `At least ${MIN_PASSWORD} characters.`,
      )}
      {rule(hasSymbol(password), "A symbol, like ! or @ or #.")}
    </ul>
  );
}
