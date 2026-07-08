import type { FigmaSource, Frame } from '@/types'

function decodePathPart(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value).replace(/-/g, ' ').trim() || undefined
  } catch {
    return value.replace(/-/g, ' ').trim() || undefined
  }
}

function normalizeNodeId(value: string | null): string | undefined {
  if (!value) return undefined
  return value.replace('-', ':')
}

export function parseFigmaUrl(rawUrl: string): FigmaSource | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (!url.hostname.includes('figma.com')) return null

  const parts = url.pathname.split('/').filter(Boolean)
  const fileTypeIndex = parts.findIndex((part) =>
    ['design', 'file', 'proto'].includes(part)
  )
  const fileKey = fileTypeIndex >= 0 ? parts[fileTypeIndex + 1] : undefined
  if (!fileKey) return null

  const nodeId = normalizeNodeId(url.searchParams.get('node-id'))
  const versionId =
    url.searchParams.get('version-id') ??
    url.searchParams.get('version') ??
    undefined

  return {
    url: trimmed,
    fileKey,
    nodeId,
    versionId,
    fileName: decodePathPart(parts[fileTypeIndex + 2]),
    selectionLabel: nodeId ? `선택 화면 ${nodeId}` : '파일 전체',
    connectedAt: new Date(),
  }
}

export function createFigmaFrame(source: FigmaSource): Frame {
  return {
    id: `figma-${Date.now()}`,
    name: 'Screen01',
    originalName: source.selectionLabel ?? source.fileName ?? 'Figma source',
    userLabel: source.fileName ?? 'Figma 연결 화면',
    flowOrder: 1,
    imageUrl: '',
    sourceType: 'figma',
    figmaFileKey: source.fileKey,
    figmaNodeId: source.nodeId,
    figmaVersionId: source.versionId,
    figmaUrl: source.url,
  }
}

export function getFigmaSourceLabel(source: FigmaSource | null): string {
  if (!source) return 'Figma 연결 안 됨'
  const file = source.fileName ?? source.fileKey
  const node = source.nodeId ? ` · ${source.nodeId}` : ''
  const version = source.versionId ? ` · v:${source.versionId}` : ''
  return `${file}${node}${version}`
}
