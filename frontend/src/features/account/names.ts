/** The first word of the person's name, for the greeting and the account menu. */
export const firstName = (fullName?: string | null) =>
  (fullName ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[,.]+$/, "") ?? "";
