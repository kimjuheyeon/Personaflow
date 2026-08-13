import type { FigmaSource, Frame, FrameDesignContext, PrototypeTransition } from '@/types'

const FIGMA_API_BASE = 'https://api.figma.com/v1'
const RENDERABLE_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])
const MAX_IMPORTED_FRAMES = 24

class FigmaProxyUnavailableError extends Error {}

interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  characters?: string
  absoluteBoundingBox?: {
    width: number
    height: number
  }
  reactions?: Array<{
    trigger?: { type?: string }
    action?: {
      type?: string
      destinationId?: string
      navigation?: string
    }
  }>
  children?: FigmaNode[]
}

interface FigmaFileResponse {
  name?: string
  version?: string
  document: FigmaNode
}

interface FigmaNodesResponse {
  name?: string
  version?: string
  nodes: Record<string, { document: FigmaNode | null } | null>
}

interface FigmaImagesResponse {
  err?: string | null
  images: Record<string, string | null>
}

export interface ImportedFigmaFrames {
  source: FigmaSource
  frames: Frame[]
}

function figmaHeaders(token: string): HeadersInit {
  return {
    'X-Figma-Token': token,
  }
}

async function buildFigmaError(response: Response): Promise<Error> {
  let detail: string | undefined
  try {
    const data = await response.json()
    detail = data?.error?.message ?? data?.error ?? data?.message ?? data?.err
  } catch {
    /* ignore */
  }

  if (response.status === 403 || response.status === 401) {
    return new Error('Figma 개인 액세스 토큰이 올바르지 않거나 파일 접근 권한이 없습니다.')
  }
  if (response.status === 404) {
    return new Error('Figma 파일 또는 선택한 화면을 찾지 못했습니다.')
  }
  return new Error(detail ?? `Figma API 요청 실패 (HTTP ${response.status})`)
}

async function fetchFigmaJsonDirect<T>(path: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: figmaHeaders(token),
    })
  } catch {
    throw new Error('Figma API에 연결하지 못했습니다. 네트워크 또는 브라우저 CORS 설정을 확인해주세요.')
  }

  if (!response.ok) {
    throw await buildFigmaError(response)
  }

  return response.json() as Promise<T>
}

async function fetchFigmaJsonViaProxy<T>(path: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/figma?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    throw new FigmaProxyUnavailableError('Figma proxy unavailable')
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new FigmaProxyUnavailableError('Figma proxy unavailable')
  }

  if (!response.ok) {
    throw await buildFigmaError(response)
  }

  return response.json() as Promise<T>
}

async function fetchFigmaJson<T>(path: string, token: string): Promise<T> {
  try {
    return await fetchFigmaJsonViaProxy<T>(path, token)
  } catch (error) {
    if (!(error instanceof FigmaProxyUnavailableError)) throw error
    return fetchFigmaJsonDirect<T>(path, token)
  }
}

function collectRenderableNodes(node: FigmaNode | null | undefined, limit = MAX_IMPORTED_FRAMES): FigmaNode[] {
  if (!node) return []

  if (RENDERABLE_TYPES.has(node.type)) {
    return [node]
  }

  const collected: FigmaNode[] = []
  const visit = (current: FigmaNode) => {
    if (collected.length >= limit) return
    if (RENDERABLE_TYPES.has(current.type)) {
      collected.push(current)
      return
    }
    for (const child of current.children ?? []) {
      visit(child)
      if (collected.length >= limit) return
    }
  }

  visit(node)
  return collected
}

function uniqueNodes(nodes: FigmaNode[]): FigmaNode[] {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })
}

function uniqueTrimmed(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawValue of values) {
    const value = rawValue.replace(/\s+/g, ' ').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}

function readableFigmaToken(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return value.toLocaleLowerCase('en-US').replace(/_/g, ' ')
}

function designContextFromNode(root: FigmaNode): FrameDesignContext {
  const visibleTexts: string[] = []
  const componentLabels: string[] = []
  const interactiveLabels: string[] = []
  const structureLabels: string[] = []
  const prototypeTransitions: PrototypeTransition[] = []
  let visited = 0

  const visit = (node: FigmaNode, depth: number) => {
    if (visited >= 600 || node.visible === false) return
    visited += 1

    if (node.type === 'TEXT' && node.characters) visibleTexts.push(node.characters)
    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      componentLabels.push(node.name)
    }
    if (depth <= 2 && node !== root) {
      structureLabels.push(`${node.type}: ${node.name}`)
    }

    for (const reaction of node.reactions ?? []) {
      const trigger = readableFigmaToken(reaction.trigger?.type, 'interaction')
      const action = readableFigmaToken(
        reaction.action?.navigation ?? reaction.action?.type,
        'navigate'
      )
      interactiveLabels.push(node.name)
      prototypeTransitions.push({
        trigger,
        action,
        sourceNodeName: node.name,
        destinationNodeId: reaction.action?.destinationId,
      })
    }

    for (const child of node.children ?? []) visit(child, depth + 1)
  }

  visit(root, 0)
  const box = root.absoluteBoundingBox
  return {
    source: 'figma_api',
    visibleTexts: uniqueTrimmed(visibleTexts, 100),
    componentLabels: uniqueTrimmed(componentLabels, 60),
    interactiveLabels: uniqueTrimmed(interactiveLabels, 60),
    structureLabels: uniqueTrimmed(structureLabels, 80),
    prototypeTransitions: prototypeTransitions.slice(0, 80),
    dimensions:
      box && Number.isFinite(box.width) && Number.isFinite(box.height)
        ? { width: Math.round(box.width), height: Math.round(box.height) }
        : undefined,
  }
}

async function fetchDetailedNodes(
  fileKey: string,
  nodeIds: string[],
  token: string
): Promise<Map<string, FigmaNode>> {
  if (nodeIds.length === 0) return new Map()
  const params = new URLSearchParams({
    ids: nodeIds.join(','),
    depth: '6',
  })
  const data = await fetchFigmaJson<FigmaNodesResponse>(
    `/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`,
    token
  )
  return new Map(
    Object.entries(data.nodes ?? []).flatMap(([id, entry]) =>
      entry?.document ? [[id, entry.document] as const] : []
    )
  )
}

async function fetchImageUrls(
  fileKey: string,
  nodeIds: string[],
  token: string
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {}

  const params = new URLSearchParams({
    ids: nodeIds.join(','),
    format: 'png',
    scale: '2',
  })

  const data = await fetchFigmaJson<FigmaImagesResponse>(
    `/images/${encodeURIComponent(fileKey)}?${params.toString()}`,
    token
  )

  if (data.err) throw new Error(data.err)

  return Object.fromEntries(
    Object.entries(data.images ?? {}).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  )
}

function frameFromNode(
  node: FigmaNode,
  source: FigmaSource,
  imageUrl: string,
  index: number
): Frame {
  return {
    id: `figma-${node.id}-${index}`,
    name: `Screen${String(index + 1).padStart(2, '0')}`,
    originalName: node.name,
    userLabel: node.name,
    flowOrder: index + 1,
    imageUrl,
    sourceType: 'figma',
    figmaFileKey: source.fileKey,
    figmaNodeId: node.id,
    figmaVersionId: source.versionId,
    figmaUrl: source.url,
    designContext: designContextFromNode(node),
  }
}

export async function importFigmaFrames(
  source: FigmaSource,
  token: string
): Promise<ImportedFigmaFrames> {
  const cleanToken = token.trim()
  if (!cleanToken) throw new Error('Figma 개인 액세스 토큰을 입력해주세요.')

  let fileName = source.fileName
  let versionId = source.versionId
  let nodes: FigmaNode[]

  if (source.nodeId) {
    const params = new URLSearchParams({
      ids: source.nodeId,
      depth: '3',
    })
    const data = await fetchFigmaJson<FigmaNodesResponse>(
      `/files/${encodeURIComponent(source.fileKey)}/nodes?${params.toString()}`,
      cleanToken
    )
    fileName = data.name ?? fileName
    versionId = versionId ?? data.version
    nodes = uniqueNodes(
      Object.values(data.nodes ?? {}).flatMap((entry) =>
        collectRenderableNodes(entry?.document)
      )
    )
  } else {
    const params = new URLSearchParams({ depth: '2' })
    const data = await fetchFigmaJson<FigmaFileResponse>(
      `/files/${encodeURIComponent(source.fileKey)}?${params.toString()}`,
      cleanToken
    )
    fileName = data.name ?? fileName
    versionId = versionId ?? data.version
    nodes = uniqueNodes(collectRenderableNodes(data.document))
  }

  const limitedNodes = nodes.slice(0, MAX_IMPORTED_FRAMES)
  if (limitedNodes.length === 0) {
    throw new Error('가져올 수 있는 Figma 화면을 찾지 못했습니다. 화면을 선택한 링크로 다시 시도해주세요.')
  }

  const importedSource: FigmaSource = {
    ...source,
    fileName,
    versionId,
    selectionLabel: source.nodeId ? `선택 화면 ${source.nodeId}` : `${limitedNodes.length}개 화면`,
    connectedAt: new Date(),
  }
  const imageUrls = await fetchImageUrls(
    source.fileKey,
    limitedNodes.map((node) => node.id),
    cleanToken
  )
  const detailedNodes = await fetchDetailedNodes(
    source.fileKey,
    limitedNodes.map((node) => node.id),
    cleanToken
  )

  return {
    source: importedSource,
    frames: limitedNodes.map((node, index) => {
      const detailedNode = detailedNodes.get(node.id) ?? node
      return frameFromNode(detailedNode, importedSource, imageUrls[node.id] ?? '', index)
    }),
  }
}
