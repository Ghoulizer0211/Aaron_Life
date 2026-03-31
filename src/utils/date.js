const TZ = 'America/Los_Angeles'

/** Current date in Pacific Time as YYYY-MM-DD */
export function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Current month in Pacific Time as YYYY-MM */
export function currentMonthPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7)
}

/** Format a Date object for display using Pacific Time */
export function fmtDisplayPT(date, opts) {
  return date.toLocaleDateString('en-US', { timeZone: TZ, ...opts })
}
