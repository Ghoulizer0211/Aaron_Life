// Curated 52-week rotation of Catholic scripture passages (one passage per week)
const PASSAGES = [
  { ref: 'MAT.5.3-MAT.5.12',   label: 'Matthew 5:3-12'    }, // Beatitudes
  { ref: 'JHN.3.16-JHN.3.17', label: 'John 3:16-17'      },
  { ref: 'PSA.23.1-PSA.23.6',  label: 'Psalm 23:1-6'      },
  { ref: 'ROM.8.28',            label: 'Romans 8:28'        },
  { ref: 'PHP.4.4-PHP.4.7',    label: 'Philippians 4:4-7' },
  { ref: 'JHN.14.6',           label: 'John 14:6'          },
  { ref: 'JHN.15.9-JHN.15.13',label: 'John 15:9-13'       },
  { ref: 'ISA.40.28-ISA.40.31',label: 'Isaiah 40:28-31'   },
  { ref: 'MAT.6.25-MAT.6.34', label: 'Matthew 6:25-34'   },
  { ref: '1CO.13.4-1CO.13.7', label: '1 Corinthians 13:4-7'},
  { ref: 'ROM.8.38-ROM.8.39', label: 'Romans 8:38-39'     },
  { ref: 'EPH.3.20-EPH.3.21', label: 'Ephesians 3:20-21'  },
  { ref: 'JAS.1.2-JAS.1.4',   label: 'James 1:2-4'        },
  { ref: 'PSA.91.1-PSA.91.4', label: 'Psalm 91:1-4'       },
  { ref: 'JER.29.11',          label: 'Jeremiah 29:11'     },
  { ref: 'PRO.3.5-PRO.3.6',   label: 'Proverbs 3:5-6'     },
  { ref: 'MIC.6.8',            label: 'Micah 6:8'          },
  { ref: 'ISA.43.1-ISA.43.3', label: 'Isaiah 43:1-3'      },
  { ref: 'DEU.31.6',           label: 'Deuteronomy 31:6'   },
  { ref: 'MAT.28.19-MAT.28.20',label:'Matthew 28:19-20'   },
  { ref: 'JHN.1.1-JHN.1.5',   label: 'John 1:1-5'         },
  { ref: 'MAT.22.37-MAT.22.39',label:'Matthew 22:37-39'   },
  { ref: 'LUK.1.46-LUK.1.49', label: 'Luke 1:46-49'       }, // Magnificat
  { ref: 'LUK.6.27-LUK.6.28', label: 'Luke 6:27-28'       },
  { ref: 'MAT.11.28-MAT.11.30',label:'Matthew 11:28-30'   },
  { ref: 'PHP.2.3-PHP.2.5',   label: 'Philippians 2:3-5'  },
  { ref: 'GAL.5.22-GAL.5.23', label: 'Galatians 5:22-23'  },
  { ref: 'ROM.12.1-ROM.12.2', label: 'Romans 12:1-2'      },
  { ref: 'HEB.11.1',           label: 'Hebrews 11:1'       },
  { ref: 'JHN.10.14-JHN.10.15',label:'John 10:14-15'      },
  { ref: 'JHN.8.31-JHN.8.32', label: 'John 8:31-32'       },
  { ref: 'MAT.5.14-MAT.5.16', label: 'Matthew 5:14-16'    },
  { ref: 'PSA.46.1-PSA.46.3', label: 'Psalm 46:1-3'       },
  { ref: 'ISA.55.8-ISA.55.9', label: 'Isaiah 55:8-9'      },
  { ref: 'JHN.6.35',           label: 'John 6:35'          },
  { ref: 'REV.21.3-REV.21.4', label: 'Revelation 21:3-4'  },
  { ref: 'PHP.4.13',           label: 'Philippians 4:13'   },
  { ref: '1JO.4.7-1JO.4.8',  label: '1 John 4:7-8'       },
  { ref: 'LUK.11.9-LUK.11.10',label:'Luke 11:9-10'        },
  { ref: 'PSA.139.1-PSA.139.4',label:'Psalm 139:1-4'      },
  { ref: 'MAT.6.9-MAT.6.13',  label: 'Matthew 6:9-13'     }, // Our Father
  { ref: 'JHN.11.25-JHN.11.26',label:'John 11:25-26'      },
  { ref: 'ROM.5.8',            label: 'Romans 5:8'         },
  { ref: 'EPH.2.8-EPH.2.9',   label: 'Ephesians 2:8-9'   },
  { ref: '1PE.5.7',            label: '1 Peter 5:7'        },
  { ref: 'MAT.18.20',          label: 'Matthew 18:20'      },
  { ref: 'JHN.14.27',          label: 'John 14:27'         },
  { ref: 'ISA.9.6',            label: 'Isaiah 9:6'         },
  { ref: 'LUK.2.10-LUK.2.11', label: 'Luke 2:10-11'       },
  { ref: 'REV.3.20',           label: 'Revelation 3:20'    },
  { ref: 'PSA.119.105',        label: 'Psalm 119:105'      },
  { ref: '2TI.3.16-2TI.3.17', label: '2 Timothy 3:16-17'  },
]

function getDayOfYear(dateStr) {
  // dateStr is YYYY-MM-DD in Pacific time
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, 0, 0)
  const now   = new Date(y, m - 1, d)
  return Math.floor((now - start) / (1000 * 60 * 60 * 24))
}

function getPassageForDate(dateStr) {
  const day  = getDayOfYear(dateStr)                // 1-366
  const week = Math.floor((day - 1) / 7)            // 0-51
  return PASSAGES[week % PASSAGES.length]
}

function stripApiBibleHtml(html = '') {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey  = process.env.BIBLE_API_KEY
  const bibleId = process.env.BIBLE_ID || 'de4e12af7f28f599-02' // KJV default

  if (!apiKey || apiKey === 'your_key_here') {
    return res.status(503).json({ error: 'BIBLE_API_KEY not configured' })
  }

  try {
    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const passage = getPassageForDate(dateStr)

    const url = `https://rest.api.bible/v1/bibles/${bibleId}/passages/${passage.ref}` +
      `?content-type=text&include-notes=false&include-titles=false` +
      `&include-chapter-numbers=false&include-verse-numbers=false&include-verse-spans=false`

    const r = await fetch(url, {
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    })

    if (!r.ok) {
      const errText = await r.text()
      throw new Error(`API.Bible ${r.status}: ${errText.slice(0, 200)}`)
    }

    const json = await r.json()
    const text = (json?.data?.content || '').trim()

    res.json({
      dayTitle:     passage.label,
      saint:        '',
      firstReading: null,
      psalm:        null,
      gospel:       { source: null, excerpt: text },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
