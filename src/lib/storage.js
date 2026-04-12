// Safe localStorage wrapper — iOS Safari throws SecurityError on localStorage
// access when the PWA resumes from background. All reads/writes go through here.

export const ls = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(key, value) } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch {}
  },
  getJSON(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
  },
  setJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  },
}

export const ss = {
  get(key, fallback = null) {
    try { return sessionStorage.getItem(key) ?? fallback } catch { return fallback }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value) } catch {}
  },
  remove(key) {
    try { sessionStorage.removeItem(key) } catch {}
  },
}
