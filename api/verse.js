export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const r    = await fetch('https://labs.bible.org/api/?passage=votd&type=json&formatting=plain')
    const json = await r.json()
    const v    = Array.isArray(json) ? json[0] : null
    if (!v) return res.status(404).json({ error: 'No verse' })
    res.json({ text: v.text, reference: `${v.bookname} ${v.chapter}:${v.verse}` })
  } catch (e) { res.status(500).json({ error: e.message }) }
}
