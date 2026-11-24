/** "Good morning" before noon, "Good afternoon" until six, "Good evening" after that. */
export const greeting = (hour: number = new Date().getHours()): string =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

export const GREETING_EMOJI = "😊";
