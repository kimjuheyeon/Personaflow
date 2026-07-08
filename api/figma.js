const FIGMA_API_BASE = 'https://api.figma.com/v1'
const ALLOWED_PATH_PREFIXES = ['/files/', '/images/']

function readBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body ?? {}
}

function readPath(req) {
  const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path
  if (typeof rawPath !== 'string') return ''
  try {
    return decodeURIComponent(rawPath)
  } catch {
    return ''
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const path = readPath(req)
  const body = readBody(req)
  const token = typeof body.token === 'string' ? body.token.trim() : ''

  if (!path || !ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    res.status(400).json({ error: 'Unsupported Figma API path' })
    return
  }

  if (!token) {
    res.status(400).json({ error: 'Missing Figma personal access token' })
    return
  }

  try {
    const figmaUrl = new URL(`${FIGMA_API_BASE}${path}`)
    const figmaResponse = await fetch(figmaUrl, {
      headers: {
        'X-Figma-Token': token,
      },
    })
    const contentType = figmaResponse.headers.get('content-type') ?? 'application/json'
    const payload = await figmaResponse.text()

    res.setHeader('Content-Type', contentType)
    res.status(figmaResponse.status).send(payload)
  } catch {
    res.status(502).json({ error: 'Figma API request failed' })
  }
}
