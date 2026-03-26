import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from 'plaid'
import { readEvents, saveEvents } from './store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TOKENS_FILE = join(__dirname, 'tokens.json')

// ─── Plaid client ─────────────────────────────────────────────────────────────

const plaidEnv = process.env.PLAID_ENV || 'sandbox'

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET':    process.env.PLAID_SECRET,
      },
    },
  })
)

// ─── Token storage ────────────────────────────────────────────────────────────

function readTokens() {
  if (!existsSync(TOKENS_FILE)) return {}
  try { return JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) }
  catch { return {} }
}

function saveTokens(data) {
  writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2))
}

// Returns array of Plaid items, migrating the old single-token format
function getPlaidItems() {
  const tokens = readTokens()
  if (tokens.plaid_items) return tokens.plaid_items
  // migrate legacy single-token
  if (tokens.access_token) return [{ access_token: tokens.access_token, item_id: 'legacy', institution_name: 'Connected Bank' }]
  return []
}

// ─── Plaid helpers ────────────────────────────────────────────────────────────

const CATEGORY_MAP = {
  'Food and Drink': 'food', 'Shops': 'shopping', 'Travel': 'transport',
  'Transportation': 'transport', 'Healthcare': 'health', 'Recreation': 'entertainment',
  'Entertainment': 'entertainment', 'Service': 'utilities', 'Community': 'utilities',
  'Bank Fees': 'other', 'Cash Advance': 'other', 'Transfer': 'other',
  'Payment': 'other', 'Tax': 'other', 'Interest': 'other',
}

function mapCategory(cats) { return CATEGORY_MAP[cats?.[0]] || 'other' }

function mapAccountType(type) {
  if (type === 'depository') return 'bank'
  if (type === 'investment')  return 'invest'
  if (type === 'credit' || type === 'loan') return 'credit'
  return 'bank'
}

async function fetchItemData(accessToken, itemId) {
  const start = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10) })()
  const end   = new Date().toISOString().slice(0, 10)

  const [accountsResult, txResult] = await Promise.allSettled([
    plaid.accountsGet({ access_token: accessToken }),
    plaid.transactionsGet({ access_token: accessToken, start_date: start, end_date: end }),
  ])

  if (accountsResult.status === 'rejected') {
    console.error(`Accounts fetch failed for item ${itemId}:`, accountsResult.reason?.response?.data || accountsResult.reason?.message)
  }
  if (txResult.status === 'rejected') {
    console.warn(`Transactions not ready for item ${itemId}:`, txResult.reason?.response?.data?.error_code || txResult.reason?.message)
  }

  const accounts = accountsResult.status === 'fulfilled'
    ? accountsResult.value.data.accounts.map(a => ({
        id:      a.account_id,
        name:    a.name,
        mask:    a.mask,
        type:    mapAccountType(a.type),
        balance: a.balances.current ?? 0,
        item_id: itemId,
      }))
    : []

  const transactions = txResult.status === 'fulfilled'
    ? txResult.value.data.transactions.map(t => ({
        id:        t.transaction_id,
        name:      t.merchant_name || t.name,
        amount:    -t.amount,
        category:  t.amount < 0 ? 'income' : mapCategory(t.category),
        date:      t.date,
        accountId: t.account_id,
        item_id:   itemId,
      }))
    : []

  return { accounts, transactions }
}

async function fetchAllItems() {
  const items = getPlaidItems()
  const results = await Promise.allSettled(
    items.map(item => fetchItemData(item.access_token, item.item_id))
  )
  return {
    accounts:     results.flatMap(r => r.status === 'fulfilled' ? r.value.accounts     : []),
    transactions: results.flatMap(r => r.status === 'fulfilled' ? r.value.transactions : []),
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// Create link token
app.post('/api/create-link-token', async (req, res) => {
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'aaron' },
      client_name: "Aaron's Life",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    res.json({ link_token: response.data.link_token })
  } catch (err) {
    console.error('create-link-token error:', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.error_message || err.message })
  }
})

// Exchange public token → add to items list, return all data
app.post('/api/exchange-token', async (req, res) => {
  const { public_token } = req.body
  if (!public_token) return res.status(400).json({ error: 'public_token required' })

  try {
    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token })
    const accessToken = exchangeRes.data.access_token
    const itemId      = exchangeRes.data.item_id

    // Get institution name
    let institutionName = 'Connected Bank'
    try {
      const itemRes = await plaid.itemGet({ access_token: accessToken })
      const instId  = itemRes.data.item.institution_id
      if (instId) {
        const instRes = await plaid.institutionsGetById({ institution_id: instId, country_codes: [CountryCode.Us] })
        institutionName = instRes.data.institution.name
      }
    } catch { /* non-fatal */ }

    // Add to items list (deduplicate by item_id)
    const tokens    = readTokens()
    const existing  = getPlaidItems().filter(i => i.item_id !== itemId)
    const newItem   = { access_token: accessToken, item_id: itemId, institution_name: institutionName }
    saveTokens({ ...tokens, plaid_items: [...existing, newItem], access_token: undefined })

    const data = await fetchAllItems()
    res.json({ ...data, items: getPlaidItems().map(({ item_id, institution_name }) => ({ item_id, institution_name })) })
  } catch (err) {
    console.error('exchange-token error:', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.error_message || err.message })
  }
})

// Sync all linked items
app.get('/api/sync', async (req, res) => {
  const items = getPlaidItems()
  if (!items.length) return res.status(404).json({ error: 'No accounts linked' })
  try {
    const data = await fetchAllItems()
    res.json({ ...data, items: items.map(({ item_id, institution_name }) => ({ item_id, institution_name })) })
  } catch (err) {
    console.error('sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Check linked status
app.get('/api/status', (req, res) => {
  const items = getPlaidItems()
  res.json({ linked: items.length > 0, count: items.length })
})

// Disconnect one institution
app.delete('/api/plaid/item/:itemId', (req, res) => {
  const tokens  = readTokens()
  const updated = getPlaidItems().filter(i => i.item_id !== req.params.itemId)
  saveTokens({ ...tokens, plaid_items: updated, access_token: undefined })
  res.json({ success: true })
})

// Disconnect all
app.delete('/api/plaid/disconnect-all', (req, res) => {
  const tokens = readTokens()
  saveTokens({ ...tokens, plaid_items: [], access_token: undefined })
  res.json({ success: true })
})

// ─── Oura Ring ────────────────────────────────────────────────────────────────

const OURA_BASE = 'https://api.ouraring.com'

async function ouraFetch(path, token) {
  const res = await fetch(`${OURA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Oura API ${res.status}`)
  }
  return res.json()
}

const secToHrs = (s) => Math.round((s || 0) / 360) / 10

app.post('/api/oura/connect', async (req, res) => {
  const { token } = req.body
  if (!token?.trim()) return res.status(400).json({ error: 'Token required' })
  try {
    await ouraFetch('/v2/usercollection/personal_info', token.trim())
    saveTokens({ ...readTokens(), oura_token: token.trim() })
    res.json({ success: true })
  } catch {
    res.status(401).json({ error: 'Invalid token — double-check your Personal Access Token' })
  }
})

app.get('/api/oura/status', (req, res) => {
  res.json({ linked: !!readTokens().oura_token })
})

app.delete('/api/oura/disconnect', (req, res) => {
  const tokens = readTokens()
  delete tokens.oura_token
  saveTokens(tokens)
  res.json({ success: true })
})

app.get('/api/oura/today', async (req, res) => {
  const { oura_token } = readTokens()
  if (!oura_token) return res.status(404).json({ error: 'Not connected' })

  const today     = req.query.date || new Date().toISOString().slice(0, 10)
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10)

  try {
    const [readinessR, dailySleepR, sleepR, activityR] = await Promise.allSettled([
      ouraFetch(`/v2/usercollection/daily_readiness?start_date=${yesterday}&end_date=${today}`, oura_token),
      ouraFetch(`/v2/usercollection/daily_sleep?start_date=${yesterday}&end_date=${today}`, oura_token),
      ouraFetch(`/v2/usercollection/sleep?start_date=${yesterday}&end_date=${today}`, oura_token),
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${today}&end_date=${today}`, oura_token),
    ])

    const readiness     = readinessR.status  === 'fulfilled' ? readinessR.value.data?.slice(-1)[0]  : null
    const dailySleep    = dailySleepR.status === 'fulfilled' ? dailySleepR.value.data?.slice(-1)[0] : null
    const sleepSessions = sleepR.status      === 'fulfilled' ? sleepR.value.data : []
    const activity      = activityR.status   === 'fulfilled' ? activityR.value.data?.slice(-1)[0]   : null

    const mainSleep = sleepSessions.find(s => s.type === 'long_sleep')
      || sleepSessions[sleepSessions.length - 1] || null

    res.json({
      readiness: readiness ? {
        score: readiness.score,
        temperature_deviation: readiness.temperature_deviation,
        contributors: readiness.contributors,
      } : null,
      sleep: {
        score:       dailySleep?.score       ?? null,
        contributors: dailySleep?.contributors ?? null,
        total_hours: mainSleep ? secToHrs(mainSleep.total_sleep_duration)  : null,
        deep_hours:  mainSleep ? secToHrs(mainSleep.deep_sleep_duration)   : null,
        rem_hours:   mainSleep ? secToHrs(mainSleep.rem_sleep_duration)    : null,
        light_hours: mainSleep ? secToHrs(mainSleep.light_sleep_duration)  : null,
        efficiency:  mainSleep?.efficiency        ?? null,
        resting_hr:  mainSleep?.lowest_heart_rate ?? null,
        avg_hrv:     mainSleep?.average_hrv       ?? null,
      },
      activity: activity ? {
        score:           activity.score,
        steps:           activity.steps,
        active_calories: activity.active_calories,
        total_calories:  activity.total_calories,
        target_calories: activity.target_calories,
      } : null,
    })
  } catch (err) {
    console.error('Oura today error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Security (PIN + Biometric) ───────────────────────────────────────────────

app.get('/api/security', (req, res) => {
  const { pin_hash, cred_id } = readTokens()
  res.json({ pin_hash: pin_hash || null, cred_id: cred_id || null })
})

app.post('/api/security/pin', (req, res) => {
  const { pin_hash } = req.body
  if (!pin_hash) return res.status(400).json({ error: 'pin_hash required' })
  saveTokens({ ...readTokens(), pin_hash })
  res.json({ success: true })
})

app.delete('/api/security/pin', (req, res) => {
  const tokens = readTokens()
  delete tokens.pin_hash
  delete tokens.cred_id
  saveTokens(tokens)
  res.json({ success: true })
})

app.post('/api/security/biometric', (req, res) => {
  const { cred_id } = req.body
  if (!cred_id) return res.status(400).json({ error: 'cred_id required' })
  saveTokens({ ...readTokens(), cred_id })
  res.json({ success: true })
})

app.delete('/api/security/biometric', (req, res) => {
  const tokens = readTokens()
  delete tokens.cred_id
  saveTokens(tokens)
  res.json({ success: true })
})

// ─── Schedule Events ──────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.json(readEvents())
})

app.post('/api/events', (req, res) => {
  const { id, title, date, startTime, endTime, color, category, notes } = req.body
  if (!id || !title) return res.status(400).json({ error: 'id and title required' })
  const events = readEvents()
  if (!events.find(e => e.id === id)) {
    events.push({ id, title, date, startTime, endTime, color, category, notes })
    saveEvents(events)
  }
  res.json({ success: true })
})

app.put('/api/events/:id', (req, res) => {
  const events = readEvents()
  const idx = events.findIndex(e => e.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  events[idx] = { ...events[idx], ...req.body, id: req.params.id }
  saveEvents(events)
  res.json({ success: true })
})

app.delete('/api/events/:id', (req, res) => {
  saveEvents(readEvents().filter(e => e.id !== req.params.id))
  res.json({ success: true })
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
