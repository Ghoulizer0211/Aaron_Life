// Simple JSON-file store for events (shared across all devices via server)
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVENTS_FILE = join(__dirname, 'events.json')

export function readEvents() {
  if (!existsSync(EVENTS_FILE)) return []
  try { return JSON.parse(readFileSync(EVENTS_FILE, 'utf8')) }
  catch { return [] }
}

export function saveEvents(events) {
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2))
}
