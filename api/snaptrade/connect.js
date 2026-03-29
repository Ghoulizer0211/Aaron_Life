import { getSnapClient, getSnapUser, saveSnapUser } from '../_lib/snaptrade.js'
import crypto from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { customRedirect } = req.body || {}

  try {
    let user = await getSnapUser()
    const snap = getSnapClient()

    if (!user) {
      const userId     = `aaron_${crypto.randomBytes(8).toString('hex')}`
      const userSecret = await snap.authentication.registerSnapTradeUser({ userId })
        .then(r => r.data?.userSecret)
      if (!userSecret) throw new Error('Failed to register SnapTrade user')
      await saveSnapUser(userId, userSecret)
      user = { userId, userSecret }
    }

    const response = await snap.authentication.loginSnapTradeUser({
      userId:     user.userId,
      userSecret: user.userSecret,
      snapTradeLoginUserRequestBody: {
        ...(customRedirect ? { customRedirect } : {}),
      },
    })
    const redirectURI = response.data?.redirectURI ?? response.data
    res.json({ redirectURI })
  } catch (err) {
    console.error('[snaptrade/connect]', err.message)
    res.status(500).json({ error: err.message })
  }
}
