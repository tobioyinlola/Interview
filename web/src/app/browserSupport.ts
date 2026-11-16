/** Tab-audio capture works only in desktop Chromium (Chrome, Edge). Re-verify in build week 1. */
export interface BrowserEnv {
  userAgent: string
  hasDisplayMedia: boolean
}

export function currentEnv(): BrowserEnv {
  return {
    userAgent: navigator.userAgent,
    hasDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
  }
}

export function isSupported({ userAgent, hasDisplayMedia }: BrowserEnv): boolean {
  if (!hasDisplayMedia) return false
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false
  // Chrome and Edge report "Chrome/"; Firefox and Safari do not.
  return /Chrome\//.test(userAgent)
}
