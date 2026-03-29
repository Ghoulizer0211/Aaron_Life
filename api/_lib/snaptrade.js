import { Snaptrade } from 'snaptrade-typescript-sdk'
import { getSupabase } from './supabase.js'

export function getSnapClient() {
  return new Snaptrade({
    clientId:    process.env.SNAPTRADE_CLIENT_ID,
    consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
  })
}

/** Read snap_user_id / snap_user_secret from env or Supabase settings table */
export async function getSnapUser() {
  const userId     = process.env.SNAPTRADE_USER_ID
  const userSecret = process.env.SNAPTRADE_USER_SECRET
  if (userId && userSecret) return { userId, userSecret }

  const supabase = getSupabase()
  if (!supabase) return null

  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['snaptrade_user_id', 'snaptrade_user_secret'])

  if (!data || data.length < 2) return null
  const map = Object.fromEntries(data.map(r => [r.key, r.value]))
  if (map.snaptrade_user_id && map.snaptrade_user_secret) {
    return { userId: map.snaptrade_user_id, userSecret: map.snaptrade_user_secret }
  }
  return null
}

/** Persist snap user credentials to Supabase settings */
export async function saveSnapUser(userId, userSecret) {
  const supabase = getSupabase()
  if (!supabase) return
  await supabase.from('settings').upsert([
    { key: 'snaptrade_user_id',     value: userId },
    { key: 'snaptrade_user_secret', value: userSecret },
  ], { onConflict: 'key' })
}
