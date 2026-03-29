const OURA_BASE = 'https://api.ouraring.com'

export async function getOuraToken() {
  return process.env.VITE_OURA_ACCESS_TOKEN || null
}

export async function ouraFetch(path, token) {
  const res = await fetch(`${OURA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Oura API ${res.status}`)
  }
  return res.json()
}

export const secToHrs = (s) => Math.round((s || 0) / 360) / 10
