import { getOuraToken } from '../_lib/oura.js'

export default async function handler(req, res) {
  const token = await getOuraToken()
  res.json({ linked: !!token })
}
