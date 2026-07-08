import type { FigmaSource, Frame } from '@/types'

const FIGMA_API_BASE = 'https://api.figma.com/v1'
const RENDERABLE_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])
const MAX_IMPORTED_FRAMES = 24

interface FigmaNode {
  id: string
  name: string
  type: string
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

async function fetchFigmaJson<T>(path: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: figmaHeaders(token),
    })
  } catch {
    throw new Error('Figma API에 연결하지 못했습니다. 네트워크 또는 브라우저 CORS 설정을 확인해주세요.')
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Figma 개인 액세스 토큰이 올바르지 않거나 파일 접근 권한이 없습니다.')
    }
    if (response.status === 404) {
      throw new Error('Figma 파일 또는 선택한 화면을 찾지 못했습니다.')
    }
    throw new Error(`Figma API 요청 실패 (HTTP ${response.status})`)
  }

  return response.json() as Promise<T>
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

async function fetchImageUrls(
  fileKey: string,
  nodeIds: string[],
  token: string
): Promise<Record<string, string>> {
  if (nodeIds.length === 0) return {}

  const params = new URLSearchParams({
    ids: nodeIds.join(','),
    format: 'png',
    scale: '1',
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

  return {
    source: importedSource,
    frames: limitedNodes.map((node, index) =>
      frameFromNode(node, importedSource, imageUrls[node.id] ?? '', index)
    ),
  }
}
