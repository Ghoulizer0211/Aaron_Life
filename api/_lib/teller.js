import https from 'node:https'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Read Teller mTLS cert/key from base64 env vars */
export function getTellerCreds() {
  const certB64 = process.env.TELLER_CERT_BASE64 || process.env.TELLER_CERT_B64
  const keyB64  = process.env.TELLER_KEY_BASE64  || process.env.TELLER_KEY_B64
  if (!certB64 || !keyB64) throw new Error('TELLER_CERT_BASE64 / TELLER_KEY_BASE64 env vars not set')
  return {
    cert: Buffer.from(certB64, 'base64').toString('utf8'),
    key:  Buffer.from(keyB64,  'base64').toString('utf8'),
  }
}

function tellerRequest(path, accessToken, { cert, key }) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(accessToken + ':').toString('base64')
    const req = https.request({
      hostname: 'api.teller.io',
      path,
      method:  'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      cert,
      key,
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 400) {
            const err = new Error(parsed.error?.message || `Teller API ${res.statusCode}`)
            err.status = res.statusCode
            reject(err)
          } else {
            resolve(parsed)
          }
        } catch {
          reject(new Error(`Teller non-JSON (${res.statusCode}): ${data.slice(0, 100)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export async function tellerFetch(path, accessToken, creds, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await tellerRequest(path, accessToken, creds)
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        await sleep((attempt + 1) * 3000)
      } else {
        throw err
      }
    }
  }
}

export function mapTellerCategory(cat) {
  if (!cat) return 'other'
  switch (cat.toLowerCase()) {
    case 'dining': case 'groceries': case 'bar': case 'restaurant': return 'food'
    case 'health': case 'healthcare': case 'medical': case 'pharmacy':
    case 'sport':  case 'gym':        case 'fitness':               return 'care'
    case 'home':   case 'rent':       case 'mortgage': case 'utilities':
    case 'phone':  case 'internet':   case 'software': case 'subscription':
    case 'streaming': case 'insurance': case 'interest': case 'fee':
    case 'service':                                               return 'bills'
    case 'transportation': case 'transport': case 'fuel':
    case 'parking':        case 'rideshare':                      return 'transport'
    case 'shopping': case 'clothing': case 'apparel':
    case 'electronics':  case 'general':                          return 'shopping'
    case 'investment':                                            return 'investing'
    case 'income': case 'payroll': case 'deposit':
    case 'transfer_in':                                           return 'income'
    case 'transfer': case 'transfer_out':                         return 'transfer'
    default:                                                      return 'other'
  }
}

export function defaultCategory(accType) {
  if (accType === 'investment') return 'investments'
  if (accType === 'credit')     return 'credit'
  return 'cash'
}
