import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import https from 'node:https'
import crypto from 'node:crypto'
import { readEvents, saveEvents } from './store.js'
import { createClient } from '@supabase/supabase-js'
import { Snaptrade } from 'snaptrade-typescript-sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TOKENS_FILE = join(__dirname, 'tokens.json')

const supabase = (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
  : null

function sbLog(label, err) {
  if (err) console.error(`[supabase] ${label}:`, err.message || err)
}

// ─── Simple in-memory cache ───────────────────────────────────────────────────
// Avoids hitting Supabase on every /api/finance/summary request.
// Busted automatically when data changes (sync, category update).

const _cache = {}
const getCached = (key) => {
  const e = _cache[key]
  return (e && Date.now() - e.ts < e.ttl) ? e.data : null
}
const setCache  = (key, data, ttlMs) => { _cache[key] = { data, ts: Date.now(), ttl: ttlMs } }
const bustCache = (...keys) => { for (const k of keys) delete _cache[k] }

// ─── Rate-limit helper ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Returns the first day of the NEXT month, used as an exclusive upper bound
// so we never hardcode -31 and hit invalid dates like 2026-02-31.
function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

// ─── Token storage (AES-256-GCM encrypted) ────────────────────────────────────
// Set TOKENS_ENCRYPTION_KEY env var to a 64-char hex string (32 bytes).
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// If no key is set, tokens are stored plaintext with a warning.

const ENC_KEY_HEX = process.env.TOKENS_ENCRYPTION_KEY
const ENC_KEY     = ENC_KEY_HEX?.length === 64 ? Buffer.from(ENC_KEY_HEX, 'hex') : null
if (!ENC_KEY) console.warn('[security] TOKENS_ENCRYPTION_KEY not set — tokens stored plaintext')

function encryptTokens(obj) {
  if (!ENC_KEY) return JSON.stringify(obj, null, 2)
  const iv         = crypto.randomBytes(12)
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv)
  const plain      = JSON.stringify(obj)
  const encrypted  = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag    = cipher.getAuthTag()
  return JSON.stringify({
    enc: 1,
    iv:  iv.toString('hex'),
    tag: authTag.toString('hex'),
    ct:  encrypted.toString('hex'),
  })
}

function decryptTokens(raw) {
  const parsed = JSON.parse(raw)
  if (!parsed.enc) return parsed          // plaintext legacy file
  if (!ENC_KEY) throw new Error('TOKENS_ENCRYPTION_KEY required to decrypt tokens')
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(parsed.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'))
  const plain = decipher.update(Buffer.from(parsed.ct, 'hex')) + decipher.final('utf8')
  return JSON.parse(plain)
}

function readTokens() {
  if (!existsSync(TOKENS_FILE)) return {}
  try { return decryptTokens(readFileSync(TOKENS_FILE, 'utf8')) }
  catch { return {} }
}

function saveTokens(data) {
  writeFileSync(TOKENS_FILE, encryptTokens(data))
}

// ─── Teller ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..')

// Resolve cert paths once at startup (not per-request)
const _rawCert = process.env.TELLER_CERT_PATH || './teller/certificate.pem'
const _rawKey  = process.env.TELLER_KEY_PATH  || './teller/private_key.pem'
const TELLER_CERT_PATH = _rawCert.startsWith('/') || _rawCert.match(/^[A-Za-z]:\\/) ? _rawCert : join(PROJECT_ROOT, _rawCert.replace(/^\.\//, ''))
const TELLER_KEY_PATH  = _rawKey.startsWith('/')  || _rawKey.match(/^[A-Za-z]:\\/)  ? _rawKey  : join(PROJECT_ROOT, _rawKey.replace(/^\.\//, ''))
console.log('[teller] cert path:', TELLER_CERT_PATH)
console.log('[teller] key path:', TELLER_KEY_PATH)

function tellerRequest(path, accessToken) {
  return new Promise((resolve, reject) => {
    if (!existsSync(TELLER_CERT_PATH)) return reject(new Error(`Teller cert file not found: ${TELLER_CERT_PATH}`))
    if (!existsSync(TELLER_KEY_PATH))  return reject(new Error(`Teller key file not found: ${TELLER_KEY_PATH}`))

    const auth = Buffer.from(accessToken + ':').toString('base64')
    const options = {
      hostname: 'api.teller.io',
      path,
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      cert: readFileSync(TELLER_CERT_PATH),
      key:  readFileSync(TELLER_KEY_PATH),
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) {
            const msg = parsed.error?.message || parsed.message || `Teller API ${res.statusCode}`
            const err = new Error(msg)
            err.status = res.statusCode
            reject(err)
          } else {
            resolve(parsed)
          }
        } catch (e) {
          reject(new Error(`Teller returned non-JSON (${res.statusCode}): ${data.slice(0,100)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Wraps tellerRequest with automatic retry on 429 rate-limit responses.
// Waits 3s after first hit, 6s after second, then gives up.
async function tellerFetch(path, accessToken, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await tellerRequest(path, accessToken)
    } catch (err) {
      const isRateLimit = err.status === 429 || err.message?.toLowerCase().includes('rate limit')
      if (isRateLimit && attempt < retries) {
        const wait = (attempt + 1) * 3000
        console.log(`[teller] 429 on ${path} — waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}`)
        await sleep(wait)
      } else {
        throw err
      }
    }
  }
}

function getTellerEnrollments() {
  return readTokens().teller_enrollments || []
}

function mapTellerType(type, subtype) {
  if (subtype === 'credit_card') return 'credit'
  if (type === 'investment') return 'invest'
  return 'bank'
}

// Maps Teller's raw category strings to our category system.
function mapTellerCategory(cat) {
  if (!cat) return 'other'
  switch (cat.toLowerCase()) {
    // Food — dining out, groceries, coffee, bars
    case 'dining':
    case 'groceries':
    case 'bar':
    case 'restaurant':   return 'food'
    // Personal Care — health, gym, pharmacy, fitness
    case 'health':
    case 'healthcare':
    case 'medical':
    case 'pharmacy':
    case 'sport':
    case 'gym':
    case 'fitness':      return 'care'
    // Bills — rent, utilities, subscriptions, phone, insurance
    case 'home':
    case 'rent':
    case 'mortgage':
    case 'utilities':
    case 'phone':
    case 'internet':
    case 'software':
    case 'subscription':
    case 'streaming':
    case 'insurance':
    case 'interest':
    case 'fee':
    case 'service':      return 'bills'
    // Transport — gas, parking, rideshare, public transit
    case 'transportation':
    case 'transport':
    case 'fuel':
    case 'parking':
    case 'rideshare':    return 'transport'
    // Shopping — retail, clothing, electronics, general
    case 'shopping':
    case 'clothing':
    case 'apparel':
    case 'electronics':
    case 'general':      return 'shopping'
    // Investing
    case 'investment':   return 'investing'
    // Income — paychecks, deposits, benefits
    case 'income':
    case 'payroll':
    case 'deposit':
    case 'transfer_in':  return 'income'
    // Transfer — between your own accounts
    case 'transfer':
    case 'transfer_out': return 'transfer'
    // Everything else → other
    default:             return 'other'
  }
}

function defaultCategory(accType) {
  if (accType === 'investment') return 'investments'
  if (accType === 'credit')     return 'credit'
  return 'cash'
}

// Prevent concurrent syncs — if one is already running, skip and return null.
let _syncInProgress = false

// preFetchedAccounts: { [enrollmentId]: rawAccountsArray }
// Pass this from /enroll to avoid re-fetching /accounts we already verified.
async function fetchAllTellerData(preFetchedAccounts = {}) {
  if (_syncInProgress) {
    console.log('[teller] sync already in progress — skipping duplicate request')
    return null
  }
  _syncInProgress = true
  try {
  const enrollments = getTellerEnrollments()
  const allAccounts = []
  const allTransactions = []

  // Load any manually-set category overrides so sync doesn't reset them
  const existingCategories = {}
  if (supabase) {
    const { data } = await supabase.from('bank_accounts').select('account_id, category_group')
    for (const a of (data || [])) existingCategories[a.account_id] = a.category_group
  }

  for (const enrollment of enrollments) {
    try {
      // FIX: reuse pre-fetched accounts if available (avoids duplicate /accounts call from enroll)
      const rawAccounts = preFetchedAccounts[enrollment.enrollmentId]
        || await tellerFetch('/accounts', enrollment.accessToken)
      console.log(`[teller] got ${rawAccounts.length} accounts for enrollment ${enrollment.enrollmentId}`)

      // Ensure bank_connections row exists — needed for FK cascade on disconnect
      if (supabase) {
        const { error } = await supabase.from('bank_connections').upsert({
          enrollment_id:    enrollment.enrollmentId,
          institution_name: enrollment.institutionName,
          access_token:     enrollment.accessToken,
          last_synced_at:   new Date().toISOString(),
        }, { onConflict: 'enrollment_id' })
        sbLog('upsert connection', error)
      }

      for (const acc of rawAccounts) {
        // Teller does NOT include balance in /accounts — need separate call
        let currentBalance = 0
        try {
          const bal = await tellerFetch(`/accounts/${acc.id}/balances`, enrollment.accessToken)
          currentBalance = parseFloat(bal.ledger ?? bal.current ?? 0)
          console.log(`[teller] balance for ${acc.name}: ledger=${currentBalance}`)
        } catch (balErr) {
          console.warn(`[teller] balance failed for ${acc.id}:`, balErr.message)
        }

        // Preserve user override, but auto-correct 'cash' for Teller credit accounts
        // (old code defaulted everything to 'cash', so don't keep that for credit cards)
        const stored = existingCategories[acc.id]
        const category_group = (stored && !(stored === 'cash' && acc.type === 'credit'))
          ? stored
          : defaultCategory(acc.type)

        const accountObj = {
          id:             acc.id,
          account_id:     acc.id,
          name:           acc.name,
          account_name:   acc.name,
          mask:           acc.last_four,
          last_four:      acc.last_four,
          type:           mapTellerType(acc.type, acc.subtype),
          subtype:        acc.subtype || acc.type,
          category_group,
          balance:         currentBalance,
          current_balance: currentBalance,
          enrollmentId:   enrollment.enrollmentId,
          institutionName: enrollment.institutionName,
          institution_name: enrollment.institutionName,
          last_synced_at: new Date().toISOString(),
        }
        allAccounts.push(accountObj)

        // Save/upsert to Supabase — only set category_group for new accounts
        if (supabase) {
          const { error } = await supabase.from('bank_accounts').upsert({
            account_id:        acc.id,
            enrollment_id:     enrollment.enrollmentId,
            account_name:      acc.name,
            type:              acc.type,
            subtype:           acc.subtype || acc.type,
            category_group,
            current_balance:   currentBalance,
            last_four:         acc.last_four,
            institution_name:  enrollment.institutionName,
            last_synced_at:    new Date().toISOString(),
          }, { onConflict: 'account_id' })
          sbLog('upsert account', error)

          // Save balance snapshot
          const today = new Date().toISOString().slice(0, 10)
          const { error: snapErr } = await supabase.from('balance_snapshots').upsert({
            account_id:    acc.id,
            balance:       currentBalance,
            snapshot_date: today,
          }, { onConflict: 'account_id,snapshot_date' })
          sbLog('upsert snapshot', snapErr)
        }

        try {
          // Incremental sync using Teller's start_date param:
          // - First sync: fetch from 2026-01-01 onwards
          // - Subsequent syncs: fetch from the last sync date
          const tokens        = readTokens()
          const lastSyncedAt  = (tokens.synced_accounts || {})[acc.id]
          const startDate     = lastSyncedAt
            ? new Date(lastSyncedAt).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
            : '2026-01-01'
          const txPath = `/accounts/${acc.id}/transactions?start_date=${startDate}`

          const rawTx = await tellerFetch(txPath, enrollment.accessToken)
          const filteredTx = rawTx
          console.log(`[teller] got ${rawTx.length} tx for ${acc.name} (start_date=${startDate})`)

          // Credit cards report charges as positive — flip sign so our convention
          // is consistent: negative = spending, positive = income/payment.
          const isCreditCard = acc.type === 'credit' || acc.subtype === 'credit_card'

          const txObjs = filteredTx.map(tx => {
            // Prefer Teller's counterparty name (clean merchant name) over raw bank description
            const displayName = tx.details?.counterparty?.name || tx.description
            return {
              id:             tx.id,
              transaction_id: tx.id,
              name:           displayName,
              description:    displayName,
              amount:         isCreditCard ? -parseFloat(tx.amount) : parseFloat(tx.amount),
              category:       mapTellerCategory(tx.details?.category),
              date:           tx.date,
              accountId:      tx.account_id,
              account_id:     tx.account_id,
              enrollmentId:   enrollment.enrollmentId,
              pending:        tx.status === 'pending',
              is_transfer:    tx.details?.category?.toLowerCase().includes('transfer') || false,
            }
          })
          allTransactions.push(...txObjs)

          if (supabase && txObjs.length > 0) {
            const txIds = txObjs.map(tx => tx.id)

            // Find which of these transactions already exist in Supabase.
            // For existing ones: only update pending/amount/date — NOT category,
            // because the user may have manually re-categorized a transaction.
            const { data: existing } = await supabase
              .from('bank_transactions')
              .select('transaction_id')
              .in('transaction_id', txIds)
            const existingIds = new Set((existing || []).map(r => r.transaction_id))

            const newRows = txObjs
              .filter(tx => !existingIds.has(tx.id))
              .map(tx => ({
                transaction_id: tx.id,
                account_id:     tx.account_id,
                date:           tx.date,
                description:    tx.description,
                amount:         tx.amount,
                category:       tx.category,    // set Teller category for new transactions
                pending:        tx.pending,
                is_transfer:    tx.is_transfer,
              }))

            const updatedRows = txObjs
              .filter(tx => existingIds.has(tx.id))
              .map(tx => ({
                transaction_id: tx.id,
                account_id:     tx.account_id,
                date:           tx.date,
                description:    tx.description,
                amount:         tx.amount,
                // category intentionally omitted — preserves manual overrides
                pending:        tx.pending,
                is_transfer:    tx.is_transfer,
              }))

            if (newRows.length > 0) {
              const { error } = await supabase.from('bank_transactions').insert(newRows)
              if (error) {
                console.error(`[supabase] insert failed for ${acc.name} (${acc.id}):`, error.message, error.details || '')
              }
            }
            if (updatedRows.length > 0) {
              const { error } = await supabase.from('bank_transactions').upsert(updatedRows, { onConflict: 'transaction_id' })
              if (error) {
                console.error(`[supabase] upsert failed for ${acc.name} (${acc.id}):`, error.message, error.details || '')
              }
            }
            console.log(`[teller] ${acc.name}: ${newRows.length} new, ${updatedRows.length} updated`)
          }

          // Update last sync timestamp for this account
          const updated = readTokens()
          updated.synced_accounts = { ...(updated.synced_accounts || {}), [acc.id]: new Date().toISOString() }
          saveTokens(updated)
        } catch (txErr) {
          console.warn(`[teller] transactions failed for ${acc.id}:`, txErr.message)
        }

        // Pause between accounts to stay under Teller's rate limit.
        // Each account makes 2 requests (balance + transactions) so we give
        // the API a full second to breathe before moving to the next account.
        await sleep(1000)
      }
    } catch (accErr) {
      console.error(`[teller] accounts failed for enrollment ${enrollment.enrollmentId}:`, accErr.message)
    }
  }

  return {
    enrollments: enrollments.map(({ enrollmentId, institutionName }) => ({ enrollmentId, institutionName })),
    accounts:     allAccounts,
    transactions: allTransactions,
  }
  } finally {
    _syncInProgress = false
  }
}

// ─── Teller Routes ────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

app.post('/api/teller/enroll', async (req, res) => {
  const { accessToken, enrollment } = req.body
  console.log('[teller/enroll] received accessToken:', accessToken ? accessToken.slice(0,8)+'...' : 'MISSING')
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' })

  try {
    console.log('[teller/enroll] verifying with /accounts call...')
    const accounts = await tellerRequest('/accounts', accessToken)
    console.log('[teller/enroll] verification OK, got', accounts.length, 'accounts')
    const institutionName = accounts[0]?.institution?.name || 'Connected Bank'
    const enrollmentId    = enrollment?.id || accessToken.slice(0, 16)

    const tokens   = readTokens()
    const existing = (tokens.teller_enrollments || []).filter(e => e.enrollmentId !== enrollmentId)
    saveTokens({ ...tokens, teller_enrollments: [...existing, { accessToken, enrollmentId, institutionName }] })

    // Save connection to Supabase
    if (supabase) {
      const { error } = await supabase.from('bank_connections').upsert({
        enrollment_id:    enrollmentId,
        institution_name: institutionName,
        access_token:     accessToken,
        last_synced_at:   new Date().toISOString(),
      }, { onConflict: 'enrollment_id' })
      sbLog('upsert connection', error)
    }

    console.log('[teller/enroll] fetching all data...')
    // FIX: pass the accounts we already fetched so fetchAllTellerData doesn't call /accounts again
    bustCache('finance:summary')
    const data = await fetchAllTellerData({ [enrollmentId]: accounts })
    if (!data) return res.status(429).json({ error: 'Sync already in progress — try again in a moment' })
    console.log('[teller/enroll] done. accounts:', data.accounts.length, 'transactions:', data.transactions.length)
    res.json({ ...data, success: true })
  } catch (err) {
    console.error('[teller/enroll] FAILED:', err.message)
    res.status(500).json({ error: err.message, detail: 'Check server console for details. If this is a certificate error, make sure TELLER_CERT_PATH and TELLER_KEY_PATH are set in .env' })
  }
})

app.get('/api/teller/status', (req, res) => {
  const enrollments = getTellerEnrollments()
  res.json({ linked: enrollments.length > 0, count: enrollments.length })
})

app.get('/api/teller/sync', async (req, res) => {
  const enrollments = getTellerEnrollments()
  if (!enrollments.length) return res.status(404).json({ error: 'No enrollments linked' })
  try {
    bustCache('finance:summary') // fresh data incoming — invalidate cached summary
    const data = await fetchAllTellerData()
    if (!data) return res.status(429).json({ error: 'Sync already in progress — try again in a moment' })
    res.json(data)
  } catch (err) {
    console.error('teller/sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/teller/disconnect/:enrollmentId', async (req, res) => {
  const { enrollmentId } = req.params

  // Remove from local token store
  const tokens = readTokens()
  const updatedEnrollments = (tokens.teller_enrollments || []).filter(e => e.enrollmentId !== enrollmentId)

  // Also remove any saved last_tx_id / synced_accounts for this enrollment's accounts.
  // We don't know the account IDs here, so we wipe all — they'll re-populate on next sync.
  const updatedTokens = { ...tokens, teller_enrollments: updatedEnrollments }
  delete updatedTokens.last_tx_id
  delete updatedTokens.synced_accounts
  saveTokens(updatedTokens)

  if (supabase) {
    // 1. Find all account_ids for this enrollment so we can delete their transactions
    const { data: accts } = await supabase
      .from('bank_accounts')
      .select('account_id')
      .eq('enrollment_id', enrollmentId)
    const accountIds = (accts || []).map(a => a.account_id)

    // 2. Delete transactions for those accounts
    if (accountIds.length > 0) {
      const { error: txErr } = await supabase
        .from('bank_transactions')
        .delete()
        .in('account_id', accountIds)
      if (txErr) console.error('[disconnect] delete transactions error:', txErr.message)
    }

    // 3. Delete the accounts
    const { error: accErr } = await supabase
      .from('bank_accounts')
      .delete()
      .eq('enrollment_id', enrollmentId)
    if (accErr) console.error('[disconnect] delete accounts error:', accErr.message)

    // 4. Delete the connection row
    const { error: connErr } = await supabase
      .from('bank_connections')
      .delete()
      .eq('enrollment_id', enrollmentId)
    if (connErr) console.error('[disconnect] delete connection error:', connErr.message)

    console.log(`[disconnect] removed enrollment ${enrollmentId}: ${accountIds.length} accounts wiped`)
  }

  bustCache('finance:summary')
  res.json({ success: true })
})

app.delete('/api/teller/disconnect-all', async (req, res) => {
  const tokens = readTokens()
  const allEnrollmentIds = (tokens.teller_enrollments || []).map(e => e.enrollmentId)

  const updatedTokens = { ...tokens, teller_enrollments: [] }
  delete updatedTokens.last_tx_id
  delete updatedTokens.synced_accounts
  saveTokens(updatedTokens)

  if (supabase && allEnrollmentIds.length > 0) {
    const { error } = await supabase
      .from('bank_connections')
      .delete()
      .in('enrollment_id', allEnrollmentIds)
    if (error) console.error('[disconnect-all] supabase delete error:', error.message)
  }

  bustCache('finance:summary')
  res.json({ success: true })
})

// ─── Finance Dashboard API ────────────────────────────────────────────────────

// GET /api/finance/summary — reads from Supabase, cached for 2 minutes
app.get('/api/finance/summary', async (req, res) => {
  // FIX: return cached result if fresh — avoids 3 Supabase queries on every request.
  // Cache is busted after sync or account category changes.
  const cached = getCached('finance:summary')
  if (cached) { console.log('[finance/summary] cache hit'); return res.json(cached) }

  try {
    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

    if (!supabase) return res.json({ cash: { total: 0, accounts: [] }, credit: { total: 0, accounts: [] }, investments: { total: 0, accounts: [] }, spending: { total: 0, inflows: 0, outflows: 0, beginning_balance: null, current_balance: 0, month: monthStr } })

    const [accRes, txRes] = await Promise.all([
      supabase.from('bank_accounts').select('*'),
      supabase.from('bank_transactions').select('*').gte('date', `${monthStr}-01`).lt('date', nextMonthStart(monthStr)),
    ])
    if (accRes.error) throw accRes.error
    const accounts     = accRes.data || []
    const transactions = txRes.data || []

    // Cash = checking + savings — use current_balance (ledger) to match balance snapshots
    const cashAccounts  = accounts.filter(a => a.category_group === 'cash')
    const cashTotal     = cashAccounts.reduce((s, a) => s + (parseFloat(a.current_balance) || 0), 0)

    // Credit cards
    const creditAccounts = accounts.filter(a => a.category_group === 'credit')
    const creditTotal    = creditAccounts.reduce((s, a) => s + (parseFloat(a.current_balance) || 0), 0)

    // Investments
    const investAccounts = accounts.filter(a => a.category_group === 'investments')
    const investTotal    = investAccounts.reduce((s, a) => s + (parseFloat(a.current_balance) || 0), 0)

    // Monthly cash transactions only (not credit, not transfers)
    const cashIds = new Set(cashAccounts.map(a => a.account_id))
    const cashTx  = transactions.filter(tx => cashIds.has(tx.account_id) && !tx.is_transfer)

    // Income = positive amounts (deposits, VA benefits, paycheck)
    // Expenses = negative amounts (purchases, bills) — exclude transfers and investing moves
    // Transfer and investing moves are not real expenses — exclude from spending totals
    const EXCLUDE_FROM_EXPENSES = new Set(['transfer', 'investing'])
    const income   = cashTx.filter(t => parseFloat(t.amount) > 0 && t.category !== 'transfer').reduce((s, t) => s + parseFloat(t.amount), 0)
    const expenses = cashTx.filter(t => parseFloat(t.amount) < 0 && !EXCLUDE_FROM_EXPENSES.has(t.category)).reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0)
    const surplus  = income - expenses  // positive = saved money, negative = overspent

    // Beginning-of-month balance snapshot (cash only, first snapshot in first 7 days)
    let beginningBalance  = null
    let beginningEstimated = false
    if (supabase) {
      const { data: snaps } = await supabase
        .from('balance_snapshots')
        .select('account_id, balance, snapshot_date')
        .gte('snapshot_date', `${monthStr}-01`)
        .lte('snapshot_date', `${monthStr}-07`)
        .order('snapshot_date', { ascending: true })

      if (snaps && snaps.length > 0) {
        const earliest = {}
        for (const s of snaps) {
          if (cashIds.has(s.account_id) && !earliest[s.account_id]) {
            earliest[s.account_id] = parseFloat(s.balance)
          }
        }
        beginningBalance = Object.values(earliest).reduce((s, b) => s + b, 0)
      }
    }

    // If no snapshot, estimate beginning balance by working backwards from current balance:
    // beginning + income - expenses = current  →  beginning = current - income + expenses
    if (beginningBalance == null) {
      beginningBalance   = cashTotal - income + expenses
      beginningEstimated = true
    }

    const result = {
      cash:        { total: cashTotal,   accounts: cashAccounts },
      credit:      { total: creditTotal, accounts: creditAccounts },
      investments: { total: investTotal, accounts: investAccounts },
      spending: {
        total:                expenses,          // money going OUT this month
        income,                                  // money coming IN this month
        expenses,                                // money going OUT this month
        surplus,                                 // income - expenses (positive = saved)
        beginning_balance:    beginningBalance,
        beginning_estimated:  beginningEstimated,
        current_balance:      cashTotal,
        month:                monthStr,
      },
    }
    setCache('finance:summary', result, 2 * 60 * 1000) // cache for 2 minutes
    res.json(result)
  } catch (err) {
    console.error('[finance/summary]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/finance/transactions?month=2026-03&limit=100
app.get('/api/finance/transactions', async (req, res) => {
  if (!supabase) return res.json([])
  try {
    const { month, accountId, limit = 100 } = req.query
    let q = supabase
      .from('bank_transactions')
      .select('*')
      .order('date', { ascending: false })
      .limit(Number(limit))
    if (month)     q = q.gte('date', `${month}-01`).lt('date', nextMonthStart(month))
    if (accountId) q = q.eq('account_id', accountId)
    const { data, error } = await q
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('[finance/transactions]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/finance/accounts
app.get('/api/finance/accounts', async (req, res) => {
  if (!supabase) return res.json([])
  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('institution_name')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/finance/transactions/:id — update category and optional note
app.patch('/api/finance/transactions/:id', async (req, res) => {
  const txId = req.params.id
  const { category, note } = req.body
  console.log('[finance] PATCH tx', { txId, category, note })
  if (!category || typeof category !== 'string') {
    return res.status(400).json({ error: 'category is required' })
  }
  if (!supabase) {
    console.warn('[finance] supabase not configured — category not saved')
    return res.status(500).json({ error: 'Supabase not configured on server' })
  }
  const update = { category }
  if (typeof note === 'string') update.note = note
  const { error, data } = await supabase
    .from('bank_transactions')
    .update(update)
    .eq('transaction_id', txId)
    .select('transaction_id, category')
  console.log('[finance] supabase update result:', { data, error: error?.message })
  if (error) {
    console.error('[finance] transaction update error:', error.message)
    return res.status(500).json({ error: error.message })
  }
  if (!data || data.length === 0) {
    console.warn('[finance] no rows matched transaction_id:', txId)
    return res.status(404).json({ error: `No transaction found with id: ${txId}` })
  }
  res.json({ success: true, updated: data[0] })
})

// PATCH /api/finance/accounts/:accountId — update category_group
app.patch('/api/finance/accounts/:accountId', async (req, res) => {
  const { category_group } = req.body
  if (!['cash', 'credit', 'investments', 'other'].includes(category_group)) {
    return res.status(400).json({ error: 'category_group must be cash, credit, investments, or other' })
  }
  bustCache('finance:summary') // category changed — summary totals are now stale
  if (supabase) {
    const { error } = await supabase
      .from('bank_accounts')
      .update({ category_group })
      .eq('account_id', req.params.accountId)
    if (error) return res.status(500).json({ error: error.message })
  }
  res.json({ success: true })
})

// GET /api/finance/spending/:month — monthly spending breakdown
app.get('/api/finance/spending/:month', async (req, res) => {
  if (!supabase) return res.json({ month: req.params.month, inflows: 0, outflows: 0, by_category: {}, transactions: [] })
  const { month } = req.params // e.g. 2026-03
  try {
    const [txRes, accRes] = await Promise.all([
      supabase.from('bank_transactions').select('*').gte('date', `${month}-01`).lt('date', nextMonthStart(month)),
      supabase.from('bank_accounts').select('*'),
    ])
    const transactions = txRes.data || []
    const accounts     = accRes.data || []

    const cashIds = new Set(accounts.filter(a => a.category_group === 'cash').map(a => a.account_id))
    const cashTx  = transactions.filter(tx => cashIds.has(tx.account_id) && !tx.is_transfer)

    const byCategory = {}
    for (const tx of cashTx.filter(t => t.amount < 0)) {
      const c = tx.category || 'other'
      byCategory[c] = (byCategory[c] || 0) + Math.abs(tx.amount)
    }

    const inflows  = cashTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const outflows = cashTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

    res.json({ month, inflows, outflows, by_category: byCategory, transactions: cashTx })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── SnapTrade ────────────────────────────────────────────────────────────────

const snapClient = new Snaptrade({
  clientId:    process.env.SNAPTRADE_CLIENT_ID,
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
})

function getSnaptradeUser() {
  const tokens     = readTokens()
  const userId     = tokens.snap_user_id     || process.env.SNAPTRADE_USER_ID
  const userSecret = tokens.snap_user_secret || process.env.SNAPTRADE_USER_SECRET
  if (!userId || !userSecret) throw new Error('SnapTrade user not registered. POST /api/snaptrade/register first.')
  return { userId, userSecret }
}

// Register a SnapTrade user (one-time setup). Idempotent — safe to call again.
app.post('/api/snaptrade/register', async (req, res) => {
  try {
    const tokens = readTokens()
    if (tokens.snap_user_id && tokens.snap_user_secret) {
      return res.json({ registered: true, userId: tokens.snap_user_id })
    }
    // Also check legacy env vars
    if (process.env.SNAPTRADE_USER_ID && process.env.SNAPTRADE_USER_SECRET) {
      saveTokens({ ...tokens, snap_user_id: process.env.SNAPTRADE_USER_ID, snap_user_secret: process.env.SNAPTRADE_USER_SECRET })
      return res.json({ registered: true, userId: process.env.SNAPTRADE_USER_ID })
    }
    const userId = `aaron_${Date.now()}`
    const response = await snapClient.authentication.registerSnapTradeUser({ userId })
    const userSecret = response.data?.userSecret
    if (!userSecret) throw new Error('No userSecret returned from SnapTrade')
    saveTokens({ ...tokens, snap_user_id: userId, snap_user_secret: userSecret })
    console.log('[snaptrade] registered user:', userId)
    res.json({ registered: true, userId })
  } catch (err) {
    console.error('snaptrade/register error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Status — returns whether user is registered and how many accounts are connected
app.get('/api/snaptrade/status', async (req, res) => {
  try {
    const tokens   = readTokens()
    const userId   = tokens.snap_user_id || process.env.SNAPTRADE_USER_ID
    const uSecret  = tokens.snap_user_secret || process.env.SNAPTRADE_USER_SECRET
    const registered = !!(userId && uSecret)
    if (!registered || !supabase) return res.json({ registered, accountCount: 0 })
    const { data } = await supabase.from('bank_accounts').select('account_id').eq('source', 'snaptrade')
    res.json({ registered, accountCount: (data || []).length })
  } catch (err) {
    res.json({ registered: false, accountCount: 0 })
  }
})

// Get connection portal URL — registers user automatically if needed
app.post('/api/snaptrade/connect', async (req, res) => {
  try {
    // Auto-register if not yet set up
    const tokens = readTokens()
    if (!tokens.snap_user_id) {
      if (process.env.SNAPTRADE_USER_ID && process.env.SNAPTRADE_USER_SECRET) {
        saveTokens({ ...tokens, snap_user_id: process.env.SNAPTRADE_USER_ID, snap_user_secret: process.env.SNAPTRADE_USER_SECRET })
      } else {
        const userId  = `aaron_${Date.now()}`
        const regRes  = await snapClient.authentication.registerSnapTradeUser({ userId })
        const uSecret = regRes.data?.userSecret
        if (!uSecret) throw new Error('Failed to register SnapTrade user')
        saveTokens({ ...tokens, snap_user_id: userId, snap_user_secret: uSecret })
      }
    }
    const { userId, userSecret } = getSnaptradeUser()
    const { customRedirect } = req.body || {}
    const response = await snapClient.authentication.loginSnapTradeUser({
      userId,
      userSecret,
      snapTradeLoginUserRequestBody: {
        ...(customRedirect ? { customRedirect } : {}),
      },
    })
    const redirectURI = response.data?.redirectURI ?? response.data
    console.log('[snaptrade] connection portal URL:', redirectURI)
    res.json({ redirectURI })
  } catch (err) {
    console.error('snaptrade/connect error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Sync SnapTrade accounts → upsert into bank_accounts table
app.post('/api/snaptrade/sync', async (req, res) => {
  try {
    const { userId, userSecret } = getSnaptradeUser()
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

    // Build auth_id → brokerage name map as fallback for institution_name
    const brokerageNames = {}
    try {
      const authRes = await snapClient.connections.listBrokerageAuthorizations({ userId, userSecret })
      for (const auth of (authRes.data || [])) {
        brokerageNames[auth.id] = auth.brokerage?.name || null
      }
    } catch (e) {
      console.warn('[snaptrade] could not fetch brokerage authorizations:', e.message)
    }

    // listUserAccounts returns name, institution_name, and balance.total per account
    const accountsRes = await snapClient.accountInformation.listUserAccounts({ userId, userSecret })
    const accounts = accountsRes.data || []

    const upserts = []
    for (const acct of accounts) {
      // balance.total is { amount: number, currency: string }
      const balance         = parseFloat(acct.balance?.total?.amount ?? acct.balance?.total ?? 0)
      const institutionName = acct.institution_name
        || brokerageNames[acct.brokerage_authorization]
        || null

      // Extract account type label from name: "First Last — Roth IRA Brokerage Account — 123456"
      const nameParts   = (acct.name || '').split(' — ')
      const accountType = nameParts.length >= 3 ? nameParts[nameParts.length - 2] : (acct.name || 'Investment')

      console.log(`[snaptrade] "${institutionName}" / "${accountType}": $${balance}`)

      upserts.push({
        account_id:        `snap_${acct.id}`,
        enrollment_id:     null,
        account_name:      acct.name || 'Investment Account',
        type:              'investment',
        subtype:           accountType,
        category_group:    'investments',
        current_balance:   balance,
        available_balance: balance,
        last_four:         acct.number ? String(acct.number).slice(-4) : null,
        institution_name:  institutionName,
        last_synced_at:    new Date().toISOString(),
        source:            'snaptrade',
        snap_account_id:   acct.id,
      })
    }

    if (upserts.length > 0) {
      const { error } = await supabase.from('bank_accounts').upsert(upserts, { onConflict: 'account_id' })
      if (error) throw error
    }

    bustCache('finance:summary')
    console.log(`[snaptrade] synced ${upserts.length} accounts`)
    res.json({ synced: upserts.length, accounts: upserts.map(a => ({ id: a.account_id, name: a.account_name, balance: a.current_balance })) })
  } catch (err) {
    console.error('snaptrade/sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Holdings (positions) for display — not stored, fetched live
app.get('/api/snaptrade/holdings', async (req, res) => {
  try {
    const { userId, userSecret } = getSnaptradeUser()
    const response = await snapClient.accountInformation.getAllUserHoldings({ userId, userSecret })
    res.json(response.data)
  } catch (err) {
    console.error('snaptrade/holdings error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Disconnect — remove all SnapTrade accounts from bank_accounts
app.delete('/api/snaptrade/disconnect', async (req, res) => {
  try {
    if (supabase) {
      const { error } = await supabase.from('bank_accounts').delete().eq('source', 'snaptrade')
      if (error) throw error
      bustCache('finance:summary')
    }
    res.json({ success: true })
  } catch (err) {
    console.error('snaptrade/disconnect error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Oura Ring ────────────────────────────────────────────────────────────────

const OURA_BASE = 'https://api.ouraring.com'

async function getOuraToken() {
  // 1. Local encrypted file (dev / persistent server)
  const fromFile = readTokens().oura_token
  if (fromFile) return fromFile
  // 2. Env var (Vercel environment variable)
  if (process.env.VITE_OURA_ACCESS_TOKEN) return process.env.VITE_OURA_ACCESS_TOKEN
  // 3. Supabase settings table (Vercel: file is ephemeral, DB is not)
  if (supabase) {
    try {
      const { data } = await supabase.from('settings').select('value').eq('key', 'oura_token').single()
      if (data?.value) {
        const tokens = readTokens(); tokens.oura_token = data.value; saveTokens(tokens)
        return data.value
      }
    } catch { /* ignore */ }
  }
  return null
}

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
    // Persist to Supabase so token survives server restarts
    if (supabase) {
      await supabase.from('settings').upsert({ key: 'oura_token', value: token.trim() })
    }
    res.json({ success: true })
  } catch {
    res.status(401).json({ error: 'Invalid token — double-check your Personal Access Token' })
  }
})

app.get('/api/oura/status', async (req, res) => {
  res.json({ linked: !!(await getOuraToken()) })
})

app.delete('/api/oura/disconnect', async (req, res) => {
  const tokens = readTokens()
  delete tokens.oura_token
  saveTokens(tokens)
  if (supabase) {
    await supabase.from('settings').delete().eq('key', 'oura_token')
  }
  res.json({ success: true })
})

app.get('/api/oura/today', async (req, res) => {
  const token = await getOuraToken()
  if (!token) return res.status(404).json({ error: 'Not connected' })

  const today     = req.query.date || new Date().toISOString().slice(0, 10)
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10)

  try {
    const [readinessR, dailySleepR, sleepR, activityR] = await Promise.allSettled([
      ouraFetch(`/v2/usercollection/daily_readiness?start_date=${yesterday}&end_date=${today}`, token),
      ouraFetch(`/v2/usercollection/daily_sleep?start_date=${yesterday}&end_date=${today}`, token),
      ouraFetch(`/v2/usercollection/sleep?start_date=${yesterday}&end_date=${today}`, token),
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${today}&end_date=${today}`, token),
    ])

    const readiness     = readinessR.status  === 'fulfilled' ? readinessR.value.data?.slice(-1)[0]  : null
    const dailySleep    = dailySleepR.status === 'fulfilled' ? dailySleepR.value.data?.slice(-1)[0] : null
    const sleepSessions = sleepR.status      === 'fulfilled' ? sleepR.value.data : []
    const activity      = activityR.status   === 'fulfilled' ? activityR.value.data?.slice(-1)[0]   : null

    const mainSleep = sleepSessions.find(s => s.type === 'long_sleep')
      || sleepSessions[sleepSessions.length - 1] || null

    // Check if gym workout logged today
    let workout_today = false
    if (supabase) {
      const { data: gw } = await supabase.from('gym_workouts').select('id').eq('date', today).neq('type', 'Rest').limit(1)
      workout_today = (gw || []).length > 0
    }

    const fmtTime = (iso) => {
      if (!iso) return null
      const d = new Date(iso)
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    }

    res.json({
      date: today,
      workout_today,
      readiness: readiness ? {
        score:                 readiness.score,
        temperature_deviation: readiness.temperature_deviation,
        contributors:          readiness.contributors,
      } : null,
      sleep: mainSleep || dailySleep ? {
        score:       dailySleep?.score       ?? null,
        contributors: dailySleep?.contributors ?? null,
        total_hours: mainSleep ? secToHrs(mainSleep.total_sleep_duration)  : null,
        deep_hours:  mainSleep ? secToHrs(mainSleep.deep_sleep_duration)   : null,
        rem_hours:   mainSleep ? secToHrs(mainSleep.rem_sleep_duration)    : null,
        light_hours: mainSleep ? secToHrs(mainSleep.light_sleep_duration)  : null,
        awake_hours: mainSleep ? secToHrs(mainSleep.awake_time ?? 0)       : null,
        efficiency:  mainSleep?.efficiency        ?? null,
        resting_hr:  mainSleep?.lowest_heart_rate ?? null,
        avg_hrv:     mainSleep?.average_hrv       ?? null,
        bedtime:     fmtTime(mainSleep?.bedtime_start),
        wake_time:   fmtTime(mainSleep?.bedtime_end),
      } : null,
      activity: activity ? {
        score:            activity.score,
        steps:            activity.steps,
        active_calories:  activity.active_calories,
        total_calories:   activity.total_calories,
        target_calories:  activity.target_calories,
        walking_miles:    activity.walking_equivalent_meters
                            ? Math.round((activity.walking_equivalent_meters / 1609.34) * 10) / 10
                            : null,
        high_minutes:   activity.high    ?? null,
        medium_minutes: activity.medium  ?? null,
        low_minutes:    activity.low     ?? null,
        non_wear:       activity.non_wear ?? null,
      } : null,
    })
  } catch (err) {
    console.error('Oura today error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// 7-30 day history for trends/sleep charts
app.get('/api/oura/week', async (req, res) => {
  const token = await getOuraToken()
  if (!token) return res.status(404).json({ error: 'Not connected' })

  const days  = Math.min(parseInt(req.query.days) || 30, 90)
  const end   = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - (days + 1) * 86400000).toISOString().slice(0, 10)

  try {
    const [readinessR, sleepR, activityR, sleepSessionsR] = await Promise.allSettled([
      ouraFetch(`/v2/usercollection/daily_readiness?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/daily_sleep?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/daily_activity?start_date=${start}&end_date=${end}`, token),
      ouraFetch(`/v2/usercollection/sleep?start_date=${start}&end_date=${end}`, token),
    ])

    const byDate = {}
    const ensure = d => { if (!byDate[d]) byDate[d] = { date: d } }

    if (readinessR.status === 'fulfilled')
      for (const r of readinessR.value.data || []) { ensure(r.day); byDate[r.day].readiness_score = r.score }

    if (sleepR.status === 'fulfilled')
      for (const s of sleepR.value.data || []) { ensure(s.day); byDate[s.day].sleep_score = s.score }

    if (activityR.status === 'fulfilled')
      for (const a of activityR.value.data || []) {
        ensure(a.day)
        byDate[a.day].activity_score = a.score
        byDate[a.day].steps = a.steps
      }

    if (sleepSessionsR.status === 'fulfilled')
      for (const s of (sleepSessionsR.value.data || []).filter(s => s.type === 'long_sleep')) {
        ensure(s.day)
        byDate[s.day].sleep_hours = secToHrs(s.total_sleep_duration)
      }

    res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
  } catch (err) {
    console.error('Oura week error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Gym Workouts ─────────────────────────────────────────────────────────────

app.get('/api/gym/workouts', async (req, res) => {
  if (!supabase) return res.json([])
  const limit = Math.min(parseInt(req.query.limit) || 60, 200)
  const { data, error } = await supabase.from('gym_workouts').select('*').order('date', { ascending: false }).limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

app.post('/api/gym/workouts', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
  const { date, type, duration_minutes, intensity, notes, exercises } = req.body
  if (!date || !type) return res.status(400).json({ error: 'date and type required' })
  const { data, error } = await supabase.from('gym_workouts')
    .insert({ date, type, duration_minutes: duration_minutes || null, intensity, notes: notes || null, exercises: exercises || [] })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.delete('/api/gym/workouts/:id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
  const { error } = await supabase.from('gym_workouts').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
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

// On startup, restore any tokens saved in Supabase so they survive server restarts
async function restoreTokensFromSupabase() {
  if (!supabase) return
  try {
    const { data } = await supabase.from('settings').select('key, value').in('key', ['oura_token'])
    if (!data?.length) return
    const tokens = readTokens()
    let changed = false
    for (const row of data) {
      if (row.value && !tokens[row.key]) {
        tokens[row.key] = row.value
        changed = true
      }
    }
    if (changed) {
      saveTokens(tokens)
      console.log('[startup] Restored tokens from Supabase:', data.map(r => r.key).join(', '))
    }
  } catch (e) {
    console.error('[startup] Failed to restore tokens from Supabase:', e.message)
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  await restoreTokensFromSupabase()
})
