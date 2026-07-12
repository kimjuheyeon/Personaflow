import { useCallback, useState } from 'react'
import {
  Check,
  GitCompare,
  GripVertical,
  ImageIcon,
  KeyRound,
  Link,
  Loader2,
  Pencil,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { importFigmaFrames } from '@/lib/figmaApi'
import { testApiKey } from '@/lib/ai/gemini'
import { MODEL_OPTIONS } from '@/lib/ai/keyStore'
import {
  clearStoredFigmaToken,
  getStoredFigmaToken,
  storeFigmaToken,
} from '@/lib/figmaAuth'
import { createFigmaFrame, getFigmaSourceLabel, parseFigmaUrl } from '@/lib/figma'
import {
  getFrameSecondaryLabel,
  normalizeFrameOrder,
  stripFileExtension,
} from '@/lib/frameNaming'
import type {
  ABTestConfig,
  DesignVariant,
  FigmaSource,
  Frame,
  SourceType,
  TestMode,
  VariantId,
} from '@/types'

interface UploadStepProps {
  frames: Frame[]
  onFramesChange: (frames: Frame[]) => void
  sourceType: SourceType
  onSourceTypeChange: (sourceType: SourceType) => void
  figmaUrl: string
  onFigmaUrlChange: (url: string) => void
  figmaSource: FigmaSource | null
  onFigmaSourceChange: (source: FigmaSource | null) => void
  testMode: TestMode
  onTestModeChange: (mode: TestMode) => void
  variants: DesignVariant[]
  onVariantsChange: (variants: DesignVariant[]) => void
  abConfig: ABTestConfig
  onAbConfigChange: (config: ABTestConfig) => void
  onNext: () => void
  hasApiKey: boolean
  apiKey: string
  model: string
  onSaveApiKey: (key: string, model: string) => void
  onRequireApiKey: () => void
}

const CRITERIA_OPTIONS = ['첫인상', '이해도', '전환 유도', '탐색 흐름', '신뢰감']

type DragScope = 'single' | VariantId
type DraggedFrame = { scope: DragScope; frameId: string }
type FigmaLinkRow = {
  id: string
  url: string
  source: FigmaSource | null
}

function makeFrame(file: File, prefix: string): Frame {
  return {
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Screen00',
    originalName: stripFileExtension(file.name),
    userLabel: '',
    flowOrder: 0,
    imageUrl: URL.createObjectURL(file),
    file,
  }
}

function isValidImage(file: File) {
  return ['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)
}

function hasFrameImage(frame: Frame): boolean {
  return Boolean(frame.file || frame.imageUrl)
}

function getFrameAssignmentKey(frame: Frame): string {
  return frame.figmaNodeId ?? frame.figmaUrl ?? frame.id
}

function cloneFrameForVariant(frame: Frame, variantId: VariantId, index: number): Frame {
  return {
    ...frame,
    id: `${variantId}-${getFrameAssignmentKey(frame)}-${index}`,
    flowOrder: index + 1,
  }
}

function splitFramesIntoVariants(
  sourceFrames: Frame[],
  currentVariants: DesignVariant[]
): DesignVariant[] {
  const readyFrames = sourceFrames.filter(hasFrameImage)
  const splitIndex = Math.max(1, Math.ceil(readyFrames.length / 2))

  return currentVariants.map((variant) => {
    const nextFrames =
      variant.id === 'A'
        ? readyFrames.slice(0, splitIndex)
        : readyFrames.slice(splitIndex)

    return {
      ...variant,
      frames: normalizeFrameOrder(
        nextFrames.map((frame, index) => cloneFrameForVariant(frame, variant.id, index))
      ),
    }
  })
}

function areVariantsEmpty(variants: DesignVariant[]): boolean {
  return variants.every((variant) => variant.frames.length === 0)
}

function makeFigmaLinkRow(url = '', source: FigmaSource | null = null): FigmaLinkRow {
  return {
    id: `figma-link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url,
    source,
  }
}

function getFigmaSourceKey(source: FigmaSource): string {
  return [source.fileKey, source.nodeId ?? '', source.versionId ?? ''].join('|')
}

function getFigmaFrameKey(frame: Frame): string {
  return [frame.figmaFileKey ?? '', frame.figmaNodeId ?? '', frame.figmaVersionId ?? ''].join('|')
}

function frameMatchesFigmaSource(frame: Frame, source: FigmaSource): boolean {
  return frame.figmaUrl === source.url || getFigmaFrameKey(frame) === getFigmaSourceKey(source)
}

function getDistinctFigmaFrameRows(frames: Frame[]): FigmaLinkRow[] {
  const seen = new Set<string>()
  return frames
    .filter((frame) => frame.sourceType === 'figma' && frame.figmaUrl && frame.figmaFileKey)
    .flatMap((frame) => {
      const key = getFigmaFrameKey(frame)
      if (seen.has(key)) return []
      seen.add(key)
      return [
        makeFigmaLinkRow(frame.figmaUrl ?? '', {
          url: frame.figmaUrl ?? '',
          fileKey: frame.figmaFileKey ?? '',
          nodeId: frame.figmaNodeId,
          versionId: frame.figmaVersionId,
          fileName: frame.userLabel ?? frame.originalName,
          selectionLabel: frame.originalName,
          connectedAt: new Date(),
        }),
      ]
    })
}

function ensureTrailingEmptyFigmaRow(rows: FigmaLinkRow[]): FigmaLinkRow[] {
  const nextRows = rows.length > 0 ? rows : [makeFigmaLinkRow()]
  const last = nextRows[nextRows.length - 1]
  return last.url.trim() ? [...nextRows, makeFigmaLinkRow()] : nextRows
}

function buildInitialFigmaRows(
  figmaUrl: string,
  figmaSource: FigmaSource | null,
  frames: Frame[]
): FigmaLinkRow[] {
  const rows = getDistinctFigmaFrameRows(frames)
  if (rows.length > 0) return ensureTrailingEmptyFigmaRow(rows)
  if (figmaSource) return ensureTrailingEmptyFigmaRow([makeFigmaLinkRow(figmaSource.url, figmaSource)])
  if (figmaUrl.trim()) return ensureTrailingEmptyFigmaRow([makeFigmaLinkRow(figmaUrl)])
  return [makeFigmaLinkRow()]
}

function getFilledFigmaRows(rows: FigmaLinkRow[]): FigmaLinkRow[] {
  return rows.filter((row) => row.url.trim())
}

export default function UploadStep({
  frames,
  onFramesChange,
  sourceType,
  onSourceTypeChange,
  figmaUrl,
  onFigmaUrlChange,
  figmaSource,
  onFigmaSourceChange,
  testMode,
  onTestModeChange,
  variants,
  onVariantsChange,
  abConfig,
  onAbConfigChange,
  onNext,
  hasApiKey,
  apiKey,
  model,
  onSaveApiKey,
  onRequireApiKey,
}: UploadStepProps) {
  const [dragTarget, setDragTarget] = useState<'single' | VariantId | null>(null)
  const [draggedFrame, setDraggedFrame] = useState<DraggedFrame | null>(null)
  const [dropFrameId, setDropFrameId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [figmaError, setFigmaError] = useState<string | null>(null)
  const [figmaToken, setFigmaToken] = useState(() => getStoredFigmaToken())
  const [figmaAccessConnected, setFigmaAccessConnected] = useState(
    () => Boolean(getStoredFigmaToken())
  )
  const [editingFigmaLinks, setEditingFigmaLinks] = useState(() => !figmaSource)
  const [figmaImporting, setFigmaImporting] = useState(false)
  const [geminiKeyInput, setGeminiKeyInput] = useState(apiKey)
  const [geminiModel, setGeminiModel] = useState(model)
  const [geminiTesting, setGeminiTesting] = useState(false)
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [figmaLinkRows, setFigmaLinkRows] = useState<FigmaLinkRow[]>(() =>
    buildInitialFigmaRows(figmaUrl, figmaSource, frames)
  )

  const handleSourceTypeChange = (nextSourceType: SourceType) => {
    onSourceTypeChange(nextSourceType)
    setFigmaError(null)
    if (nextSourceType === 'figma') {
      const figmaFrames = frames.filter((frame) => frame.sourceType === 'figma')
      if (figmaFrames.length > 0) {
        onFramesChange(normalizeFrameOrder(figmaFrames))
        if (testMode === 'ab') {
          onVariantsChange(splitFramesIntoVariants(figmaFrames, variants))
        }
      } else if (figmaSource) {
        onFramesChange(normalizeFrameOrder([createFigmaFrame(figmaSource)]))
        if (testMode === 'ab') {
          onVariantsChange(variants.map((variant) => ({ ...variant, frames: [] })))
        }
      }
    } else {
      const imageFrames = frames.filter((frame) => frame.sourceType !== 'figma')
      if (imageFrames.length !== frames.length) {
        onFramesChange(normalizeFrameOrder(imageFrames))
      }
      onVariantsChange(
        variants.map((variant) => ({
          ...variant,
          frames: normalizeFrameOrder(
            variant.frames.filter((frame) => frame.sourceType !== 'figma')
          ),
        }))
      )
    }
  }

  const handleTestModeChange = (nextMode: TestMode) => {
    onTestModeChange(nextMode)
    const hasFigmaAssignments = variants.some((variant) =>
      variant.frames.some((frame) => frame.sourceType === 'figma')
    )
    if (
      sourceType === 'figma' &&
      nextMode === 'ab' &&
      (!hasFigmaAssignments || areVariantsEmpty(variants)) &&
      frames.some(hasFrameImage)
    ) {
      onVariantsChange(splitFramesIntoVariants(frames, variants))
    }
  }

  const handleFigmaRowUrlChange = (rowId: string, url: string) => {
    const previousSource = figmaLinkRows.find((row) => row.id === rowId)?.source
    setFigmaLinkRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, url, source: null } : row))
    )
    if (previousSource) {
      const nextSource =
        figmaLinkRows.find((row) => row.id !== rowId && row.source)?.source ?? null
      onFigmaSourceChange(nextSource)
      onFramesChange(
        normalizeFrameOrder(
          frames.filter(
            (frame) => frame.sourceType !== 'figma' || !frameMatchesFigmaSource(frame, previousSource)
          )
        )
      )
      onVariantsChange(
        variants.map((variant) => ({
          ...variant,
          frames: normalizeFrameOrder(
            variant.frames.filter((frame) => !frameMatchesFigmaSource(frame, previousSource))
          ),
        }))
      )
    }
    onFigmaUrlChange(url)
    setFigmaError(null)
  }

  const handleConnectFigma = (rowId: string) => {
    const row = figmaLinkRows.find((item) => item.id === rowId)
    const source = parseFigmaUrl(row?.url ?? '')
    if (!source) {
      setFigmaError('올바른 Figma 프레임 링크를 입력해주세요.')
      return
    }
    if (!source.nodeId) {
      setFigmaError(
        '선택한 프레임 링크가 아닙니다. Figma에서 프레임을 선택하고 Ctrl/⌘ + L을 눌러 다시 복사해 주세요.'
      )
      return
    }

    setFigmaError(null)
    onFigmaSourceChange(source)
    onFigmaUrlChange(source.url)
    onSourceTypeChange('figma')
    setEditingFigmaLinks(false)
    setFigmaLinkRows((rows) =>
      ensureTrailingEmptyFigmaRow(
        rows.map((item) => (item.id === rowId ? { ...item, url: source.url, source } : item))
      )
    )

    const existingFigmaFrames = frames.filter((frame) => frame.sourceType === 'figma')
    const nextSourceKey = getFigmaSourceKey(source)
    const nextFrames = existingFigmaFrames.some((frame) => getFigmaFrameKey(frame) === nextSourceKey)
      ? existingFigmaFrames
      : [...existingFigmaFrames, createFigmaFrame(source)]
    onFramesChange(normalizeFrameOrder(nextFrames))
    if (testMode === 'ab') {
      onVariantsChange(variants.map((variant) => ({ ...variant, frames: [] })))
    }
  }

  const handleImportFigmaFrames = async () => {
    const filledRows = getFilledFigmaRows(figmaLinkRows)
    const parsedRows = filledRows.map((row) => ({
      row,
      source: row.source ?? parseFigmaUrl(row.url),
    }))
    const invalidRow = parsedRows.find((item) => !item.source?.nodeId)
    if (parsedRows.length === 0 || invalidRow) {
      setFigmaError(
        '선택한 프레임 링크만 지원합니다. Figma에서 프레임을 선택하고 Ctrl/⌘ + L로 링크를 복사해 주세요.'
      )
      return
    }

    setFigmaImporting(true)
    setFigmaError(null)

    try {
      storeFigmaToken(figmaToken)
      const importedList = await Promise.all(
        parsedRows.map(({ source }) => importFigmaFrames(source as FigmaSource, figmaToken))
      )
      const importedFrames = normalizeFrameOrder(importedList.flatMap((imported) => imported.frames))
      const primarySource = importedList[0]?.source ?? parsedRows[0].source
      if (primarySource) {
        onFigmaSourceChange(primarySource)
        onFigmaUrlChange(primarySource.url)
      }
      onSourceTypeChange('figma')
      onFramesChange(importedFrames)
      setFigmaLinkRows((rows) =>
        ensureTrailingEmptyFigmaRow(
          rows.map((row) => {
            const imported = importedList.find((item) => item.source.url === row.url.trim())
            return imported ? { ...row, url: imported.source.url, source: imported.source } : row
          })
        )
      )
      if (testMode === 'ab') {
        onVariantsChange(splitFramesIntoVariants(importedFrames, variants))
      }
    } catch (e) {
      setFigmaError(e instanceof Error ? e.message : 'Figma 화면 이미지를 가져오지 못했습니다.')
    } finally {
      setFigmaImporting(false)
    }
  }

  const handleRemoveFigmaLinkRow = (rowId: string) => {
    const row = figmaLinkRows.find((item) => item.id === rowId)
    const source = row?.source ?? null
    const nextRows = ensureTrailingEmptyFigmaRow(
      figmaLinkRows.filter((item) => item.id !== rowId)
    )
    setFigmaLinkRows(nextRows)

    if (source) {
      const nextFrames = normalizeFrameOrder(
        frames.filter((frame) => frame.sourceType !== 'figma' || !frameMatchesFigmaSource(frame, source))
      )
      onFramesChange(nextFrames)
      onVariantsChange(
        variants.map((variant) => ({
          ...variant,
          frames: normalizeFrameOrder(
            variant.frames.filter((frame) => !frameMatchesFigmaSource(frame, source))
          ),
        }))
      )
    }

    const nextFilledRows = getFilledFigmaRows(nextRows)
    const nextSource = nextFilledRows.find((item) => item.source)?.source ?? null
    onFigmaSourceChange(nextSource)
    onFigmaUrlChange(nextFilledRows[0]?.url ?? '')
    setFigmaError(null)
  }

  const handleClearFigmaToken = () => {
    clearStoredFigmaToken()
    setFigmaToken('')
    setFigmaAccessConnected(false)
  }

  const handleConnectFigmaAccess = () => {
    if (!figmaToken.trim()) {
      setFigmaError('Figma 개인 액세스 토큰을 입력해주세요.')
      return
    }
    storeFigmaToken(figmaToken.trim())
    setFigmaAccessConnected(true)
    setFigmaError(null)
  }

  const handleConnectGemini = async () => {
    if (!geminiKeyInput.trim()) return
    setGeminiTesting(true)
    setGeminiError(null)
    try {
      await testApiKey(geminiKeyInput.trim(), geminiModel)
      onSaveApiKey(geminiKeyInput.trim(), geminiModel)
    } catch (error) {
      setGeminiError(error instanceof Error ? error.message : 'Gemini 연결 테스트에 실패했습니다.')
    } finally {
      setGeminiTesting(false)
    }
  }

  const processSingleFiles = useCallback(
    (files: FileList | File[]) => {
      const newFrames = Array.from(files)
        .filter(isValidImage)
        .map((file) => makeFrame(file, 'frame'))
      onFramesChange(normalizeFrameOrder([...frames, ...newFrames]))
    },
    [frames, onFramesChange]
  )

  const updateVariantFrames = (variantId: VariantId, nextFrames: Frame[]) => {
    const normalizedFrames = normalizeFrameOrder(nextFrames)
    onVariantsChange(
      variants.map((variant) =>
        variant.id === variantId ? { ...variant, frames: normalizedFrames } : variant
      )
    )
  }

  const processVariantFiles = (variantId: VariantId, files: FileList | File[]) => {
    const variant = variants.find((item) => item.id === variantId)
    if (!variant) return

    const newFrames = Array.from(files)
      .filter(isValidImage)
      .map((file) => makeFrame(file, `variant-${variantId}`))

    updateVariantFrames(variantId, [...variant.frames, ...newFrames])
  }

  const handleSingleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragTarget(null)
      processSingleFiles(e.dataTransfer.files)
    },
    [processSingleFiles]
  )

  const handleVariantDrop = (variantId: VariantId, e: React.DragEvent) => {
    e.preventDefault()
    setDragTarget(null)
    processVariantFiles(variantId, e.dataTransfer.files)
  }

  const handleDragOver = (target: 'single' | VariantId, e: React.DragEvent) => {
    e.preventDefault()
    setDragTarget(target)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragTarget(null)
  }

  const handleSingleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processSingleFiles(e.target.files)
      e.target.value = ''
    }
  }

  const handleVariantFileChange = (
    variantId: VariantId,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files) {
      processVariantFiles(variantId, e.target.files)
      e.target.value = ''
    }
  }

  const revokeFrameUrl = (frame: Frame) => {
    if (!frame.imageUrl.startsWith('blob:')) return
    URL.revokeObjectURL(frame.imageUrl)
  }

  const handleDeleteSingle = (id: string) => {
    const frame = frames.find((item) => item.id === id)
    if (frame) revokeFrameUrl(frame)
    onFramesChange(normalizeFrameOrder(frames.filter((item) => item.id !== id)))
  }

  const handleDeleteVariant = (variantId: VariantId, id: string) => {
    const variant = variants.find((item) => item.id === variantId)
    if (!variant) return
    const frame = variant.frames.find((item) => item.id === id)
    if (frame) revokeFrameUrl(frame)
    updateVariantFrames(
      variantId,
      variant.frames.filter((item) => item.id !== id)
    )
  }

  const startEdit = (frame: Frame) => {
    setEditingId(frame.id)
    setEditingName(frame.userLabel ?? '')
  }

  const commitSingleEdit = (id: string) => {
    const userLabel = editingName.trim() || undefined
    onFramesChange(
      frames.map((frame) =>
        frame.id === id ? { ...frame, userLabel } : frame
      )
    )
    setEditingId(null)
  }

  const commitVariantEdit = (variantId: VariantId, id: string) => {
    const variant = variants.find((item) => item.id === variantId)
    if (!variant) return
    const userLabel = editingName.trim() || undefined
    updateVariantFrames(
      variantId,
      variant.frames.map((frame) =>
        frame.id === id ? { ...frame, userLabel } : frame
      )
    )
    setEditingId(null)
  }

  const reorderFrames = (list: Frame[], activeId: string, overId: string) => {
    const activeIndex = list.findIndex((frame) => frame.id === activeId)
    const overIndex = list.findIndex((frame) => frame.id === overId)
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return list

    const next = [...list]
    const [moved] = next.splice(activeIndex, 1)
    next.splice(overIndex, 0, moved)
    return normalizeFrameOrder(next)
  }

  const handleFrameDragStart = (
    scope: DragScope,
    frameId: string,
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.stopPropagation()
    setDraggedFrame({ scope, frameId })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/personaflow-frame', frameId)
  }

  const handleFrameDragOver = (
    scope: DragScope,
    frameId: string,
    e: React.DragEvent<HTMLDivElement>
  ) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      return
    }
    if (!draggedFrame || draggedFrame.scope !== scope || draggedFrame.frameId === frameId) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropFrameId(frameId)
  }

  const handleFrameDrop = (
    scope: DragScope,
    frameId: string,
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedFrame || draggedFrame.scope !== scope) {
      setDraggedFrame(null)
      setDropFrameId(null)
      return
    }

    if (scope === 'single') {
      onFramesChange(reorderFrames(frames, draggedFrame.frameId, frameId))
    } else {
      const variant = variants.find((item) => item.id === scope)
      if (variant) {
        updateVariantFrames(scope, reorderFrames(variant.frames, draggedFrame.frameId, frameId))
      }
    }

    setDraggedFrame(null)
    setDropFrameId(null)
  }

  const handleFrameDragEnd = () => {
    setDraggedFrame(null)
    setDropFrameId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, commit: () => void) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditingId(null)
  }

  const toggleCriterion = (criterion: string) => {
    const exists = abConfig.criteria.includes(criterion)
    const criteria = exists
      ? abConfig.criteria.filter((item) => item !== criterion)
      : [...abConfig.criteria, criterion]

    onAbConfigChange({
      ...abConfig,
      criteria: criteria.length > 0 ? criteria : [criterion],
    })
  }

  const assignFigmaFrameToVariant = (variantId: VariantId, frame: Frame) => {
    const variant = variants.find((item) => item.id === variantId)
    if (!variant || !hasFrameImage(frame)) return

    const sourceKey = getFrameAssignmentKey(frame)
    if (variant.frames.some((item) => getFrameAssignmentKey(item) === sourceKey)) return

    updateVariantFrames(variantId, [
      ...variant.frames,
      cloneFrameForVariant(frame, variantId, variant.frames.length),
    ])
  }

  const resetFigmaVariantSplit = () => {
    onVariantsChange(splitFramesIntoVariants(frames, variants))
  }

  const variantA = variants.find((variant) => variant.id === 'A')
  const variantB = variants.find((variant) => variant.id === 'B')
  const filledFigmaRows = getFilledFigmaRows(figmaLinkRows)
  const connectedFigmaRows = figmaLinkRows.filter((row) => row.source)
  const hasConnectedFigmaSource = connectedFigmaRows.length > 0 || Boolean(figmaSource)
  const figmaLinkStepComplete = hasApiKey && hasConnectedFigmaSource
  const figmaAccessStepComplete = figmaLinkStepComplete && figmaAccessConnected
  const figmaConnectionLabel =
    connectedFigmaRows.length > 1
      ? `${connectedFigmaRows.length}개 Figma 링크 연결됨`
      : figmaSource
      ? getFigmaSourceLabel(figmaSource)
      : connectedFigmaRows[0]?.source
      ? getFigmaSourceLabel(connectedFigmaRows[0].source)
      : 'Figma 연결됨'
  const figmaReadyFrames = frames.filter((frame) => frame.sourceType === 'figma' && hasFrameImage(frame))
  const hasFigmaFrameImages = sourceType === 'figma' && figmaReadyFrames.length > 0
  const abFrames = variants.flatMap((variant) => variant.frames)
  const hasABFrames = Boolean(variantA?.frames.length && variantB?.frames.length)
  const hasReadyABFrames = hasABFrames && abFrames.every(hasFrameImage)
  const canProceed =
    testMode === 'single'
      ? sourceType === 'figma'
        ? Boolean(hasConnectedFigmaSource && hasFigmaFrameImages && frames.every(hasFrameImage))
        : frames.length > 0
      : sourceType === 'figma'
      ? Boolean(hasConnectedFigmaSource && hasReadyABFrames)
      : hasReadyABFrames

  const sourceReady =
    testMode === 'single'
      ? sourceType === 'figma'
        ? Boolean(hasConnectedFigmaSource && hasFigmaFrameImages && frames.every(hasFrameImage))
        : frames.length > 0
      : sourceType === 'figma'
      ? Boolean(hasConnectedFigmaSource && hasReadyABFrames)
      : hasReadyABFrames

  const getNextStepHint = () => {
    if (sourceType === 'figma' && !hasConnectedFigmaSource) {
      return '계속하려면 Figma 링크를 연결하세요.'
    }
    if (sourceType === 'figma' && !hasFigmaFrameImages) {
      return '계속하려면 분석할 Figma 화면 이미지를 가져오세요.'
    }
    if (testMode === 'ab' && !hasReadyABFrames) {
      return 'A안과 B안에 각각 한 개 이상의 화면을 추가하세요.'
    }
    if (sourceType === 'image' && frames.length === 0) {
      return '계속하려면 분석할 이미지를 업로드하세요.'
    }
    return '디자인 준비가 완료되었습니다. 페르소나를 설정해 보세요.'
  }

  const renderFrameGrid = (
    scope: DragScope,
    list: Frame[],
    onDelete: (id: string) => void,
    onCommitEdit: (id: string) => void
  ) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {list.map((frame) => (
        <div
          key={frame.id}
          draggable={editingId !== frame.id}
          onDragStart={(e) => handleFrameDragStart(scope, frame.id, e)}
          onDragOver={(e) => handleFrameDragOver(scope, frame.id, e)}
          onDrop={(e) => handleFrameDrop(scope, frame.id, e)}
          onDragEnd={handleFrameDragEnd}
          className={`bg-white rounded-md border overflow-hidden group transition ${
            dropFrameId === frame.id
              ? 'border-blue-400 ring-2 ring-blue-100'
              : 'border-gray-200'
          } ${draggedFrame?.frameId === frame.id ? 'opacity-60' : ''}`}
        >
          <div className="aspect-video bg-gray-100 relative overflow-hidden">
            {frame.imageUrl ? (
              <img
                src={frame.imageUrl}
                alt={frame.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-gray-300" />
              </div>
            )}
            <button
              onClick={() => onDelete(frame.id)}
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="px-2 py-1.5">
            {editingId === frame.id ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, () => onCommitEdit(frame.id))}
                  onBlur={() => onCommitEdit(frame.id)}
                  placeholder={frame.originalName ?? '화면 역할 입력'}
                  className="h-6 text-xs px-1.5"
                  autoFocus
                />
                <button
                  onClick={() => onCommitEdit(frame.id)}
                  className="w-5 h-5 flex items-center justify-center text-blue-500 hover:text-blue-600 flex-shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-1 group/name">
                <GripVertical className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-gray-800 truncate leading-tight">
                    {frame.name}
                  </span>
                  {getFrameSecondaryLabel(frame) && (
                    <span className="mt-0.5 block text-[10px] text-gray-400 truncate leading-tight">
                      {getFrameSecondaryLabel(frame)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => startEdit(frame)}
                  className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 opacity-0 group-hover/name:opacity-100 transition-opacity flex-shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  const renderAiModeControl = () => (
    <div className="rounded-[18px] border border-white/10 bg-[#272729] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-gray-900">실행 모드</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-[11px] font-medium text-white">
          <KeyRound className="h-3 w-3" />
          실제 AI
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Gemini 무료 API 키와 실제 화면 이미지로 페르소나 테스트를 실행합니다.
      </p>
    </div>
  )

  const renderTestModeControl = () => (
    <div className="inline-flex rounded-full bg-gray-100 p-1">
      <button
        onClick={() => handleTestModeChange('single')}
        className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
          testMode === 'single'
            ? 'bg-[#48484a] text-white'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        단일 시안
      </button>
      <button
        onClick={() => handleTestModeChange('ab')}
        className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-colors ${
          testMode === 'ab'
            ? 'bg-[#48484a] text-white'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        <GitCompare className="h-3.5 w-3.5" />
        A/B 비교
      </button>
    </div>
  )

  const renderEmptyDropZone = (
    target: 'single' | VariantId,
    onDrop: (e: React.DragEvent) => void,
    inputId: string,
    title: string,
    description: string
  ) => (
    <label
      htmlFor={inputId}
      className={`
        border border-dashed rounded-[18px] transition-colors cursor-pointer
        flex flex-col items-center justify-center gap-3 py-16
        ${dragTarget === target ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-[#1c1c1e] hover:bg-[#242426]'}
      `}
      onDrop={onDrop}
      onDragOver={(e) => handleDragOver(target, e)}
      onDragLeave={handleDragLeave}
    >
      <Upload className="w-7 h-7 text-gray-400" />
      <div className="text-center">
        <p className="text-sm text-gray-600 font-medium">{title}</p>
        <p className="text-xs text-gray-400 mt-1">{description}</p>
      </div>
    </label>
  )

  const renderAddMore = (
    target: 'single' | VariantId,
    onDrop: (e: React.DragEvent) => void,
    inputId: string
  ) => (
    <label
      htmlFor={inputId}
      className={`
        border border-dashed rounded-[11px] transition-colors cursor-pointer
        flex items-center justify-center gap-2 py-4
        ${dragTarget === target ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
      `}
      onDrop={onDrop}
      onDragOver={(e) => handleDragOver(target, e)}
      onDragLeave={handleDragLeave}
    >
      <Plus className="w-4 h-4 text-gray-400" />
      <span className="text-sm text-gray-500">화면 추가</span>
    </label>
  )

  const renderVariantPane = (variant: DesignVariant) => (
    <div key={variant.id} className="border border-white/10 rounded-[18px] bg-[#272729] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{variant.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{variant.frames.length}개 화면</p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded font-semibold ${
            variant.id === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {variant.id}안
        </span>
      </div>

      {variant.frames.length === 0 ? (
        renderEmptyDropZone(
          variant.id,
          (e) => handleVariantDrop(variant.id, e),
          `variant-${variant.id}-upload`,
          `${variant.name} 화면 업로드`,
          'PNG, JPG · 여러 장 업로드 가능'
        )
      ) : (
        <div className="space-y-4">
          {renderFrameGrid(
            variant.id,
            variant.frames,
            (id) => handleDeleteVariant(variant.id, id),
            (id) => commitVariantEdit(variant.id, id)
          )}
          {renderAddMore(
            variant.id,
            (e) => handleVariantDrop(variant.id, e),
            `variant-${variant.id}-upload`
          )}
        </div>
      )}

      <input
        id={`variant-${variant.id}-upload`}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => handleVariantFileChange(variant.id, e)}
      />
    </div>
  )

  const renderFigmaVariantPane = (variant: DesignVariant) => (
    <div key={variant.id} className="border border-white/10 rounded-[18px] bg-[#272729] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{variant.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{variant.frames.length}개 화면</p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded font-semibold ${
            variant.id === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {variant.id}안
        </span>
      </div>

      {variant.frames.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 text-center">
          <p className="text-xs leading-relaxed text-gray-400">
            가져온 Figma 화면에서 {variant.id}안에 넣을 화면을 선택하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {renderFrameGrid(
            variant.id,
            variant.frames,
            (id) => handleDeleteVariant(variant.id, id),
            (id) => commitVariantEdit(variant.id, id)
          )}
        </div>
      )}
    </div>
  )

  const renderFigmaABBuilder = () => {
    if (figmaReadyFrames.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <GitCompare className="mx-auto mb-3 h-7 w-7 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">A/B 비교용 화면 이미지가 필요합니다</p>
          <p className="mt-1 text-xs text-gray-400">
            Figma 개인 액세스 토큰으로 화면 이미지를 가져온 뒤 A안과 B안에 배정하세요.
          </p>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">가져온 Figma 화면</p>
              <p className="mt-0.5 text-xs text-gray-500">
                각 화면을 A안 또는 B안에 추가해 비교 흐름을 구성하세요.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetFigmaVariantSplit}
              className="h-8"
            >
              자동 배정
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {figmaReadyFrames.map((frame) => {
              const frameKey = getFrameAssignmentKey(frame)
              const assignedA = Boolean(
                variantA?.frames.some((item) => getFrameAssignmentKey(item) === frameKey)
              )
              const assignedB = Boolean(
                variantB?.frames.some((item) => getFrameAssignmentKey(item) === frameKey)
              )

              return (
                <div key={frame.id} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                  <div className="aspect-video overflow-hidden rounded bg-white">
                    <img src={frame.imageUrl} alt={frame.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-gray-800">{frame.name}</p>
                      {getFrameSecondaryLabel(frame) && (
                        <p className="mt-0.5 truncate text-[10px] text-gray-400">
                          {getFrameSecondaryLabel(frame)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button
                        type="button"
                        variant={assignedA ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => assignFigmaFrameToVariant('A', frame)}
                        disabled={assignedA}
                        className="h-7 px-2 text-xs"
                      >
                        A
                      </Button>
                      <Button
                        type="button"
                        variant={assignedB ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => assignFigmaFrameToVariant('B', frame)}
                        disabled={assignedB}
                        className="h-7 px-2 text-xs"
                      >
                        B
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {variants.map(renderFigmaVariantPane)}
        </div>

        <p className="text-xs text-gray-400">
          각 안의 카드 순서가 페르소나가 이동하는 화면 순서입니다. A안과 B안 모두 최소 1개 이상의 화면이 필요합니다.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-8">
      <div>
        <div>
          <p className="text-sm font-medium text-blue-600">새로운 UX 테스트</p>
          <h2 className="mt-2 text-[34px] font-semibold leading-tight tracking-[-0.025em] text-gray-950">
            테스트할 디자인을 가져오세요.
          </h2>
          <p className="mt-2 text-[17px] leading-relaxed text-gray-500">
            Figma 링크를 연결하거나 이미지 파일을 업로드하면 됩니다.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleSourceTypeChange('figma')}
          className={`flex items-center gap-4 rounded-[18px] border p-5 text-left transition-colors ${
            sourceType === 'figma'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-white/10 bg-[#1c1c1e] hover:bg-[#242426]'
          }`}
        >
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${sourceType === 'figma' ? 'bg-blue-500 text-white' : 'bg-white/5 text-gray-500'}`}>
            <Link className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold text-gray-900">Figma에서 가져오기</span>
            <span className="mt-1 block text-xs text-gray-500">파일 또는 프레임 링크 사용</span>
          </span>
          {sourceType === 'figma' && <Check className="ml-auto h-5 w-5 text-blue-500" />}
        </button>

        <button
          type="button"
          onClick={() => handleSourceTypeChange('image')}
          className={`flex items-center gap-4 rounded-[18px] border p-5 text-left transition-colors ${
            sourceType === 'image'
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-white/10 bg-[#1c1c1e] hover:bg-[#242426]'
          }`}
        >
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${sourceType === 'image' ? 'bg-blue-500 text-white' : 'bg-white/5 text-gray-500'}`}>
            <Upload className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold text-gray-900">이미지 업로드</span>
            <span className="mt-1 block text-xs text-gray-500">PNG 또는 JPG 파일 사용</span>
          </span>
          {sourceType === 'image' && <Check className="ml-auto h-5 w-5 text-blue-500" />}
        </button>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#1c1c1e]">
        <div className="grid grid-cols-1">
          <section className="space-y-7 p-7 sm:p-8">
            {sourceType === 'figma' ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-[21px] font-semibold tracking-[-0.015em] text-gray-950">
                      Figma 디자인 가져오기
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      네 단계를 완료하면 AI 페르소나 테스트가 준비됩니다.
                    </p>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-gray-500">
                    {[hasApiKey, figmaLinkStepComplete, figmaAccessStepComplete, hasFigmaFrameImages].filter(Boolean).length} / 4 완료
                  </span>
                </div>

                <div className="space-y-3">
                  <div className={`rounded-[18px] border p-5 ${hasApiKey ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-blue-500/40 bg-[#272729]'}`}>
                    <div className="flex items-start gap-4">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${hasApiKey ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
                        {hasApiKey ? <Check className="h-4 w-4" /> : '1'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-gray-900">Gemini AI 연결</p>
                        <p className="mt-1 text-xs text-gray-500">AI 페르소나 분석에 사용할 무료 Gemini API 키를 연결합니다.</p>

                        {hasApiKey ? (
                          <div className="mt-4 flex items-center justify-between rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-gray-800">Gemini 연결 완료</p>
                              <p className="mt-1 text-xs text-gray-500">{MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model}</p>
                            </div>
                            <button type="button" onClick={onRequireApiKey} className="text-xs font-medium text-blue-500 hover:text-blue-400">API 키 변경</button>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-3">
                            <a
                              href="https://aistudio.google.com/apikey"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center text-xs font-medium text-blue-500 hover:text-blue-400"
                            >
                              Google AI Studio에서 무료 API 키 발급받기 →
                            </a>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_260px_auto]">
                              <Input
                                type="password"
                                value={geminiKeyInput}
                                onChange={(event) => {
                                  setGeminiKeyInput(event.target.value)
                                  setGeminiError(null)
                                }}
                                placeholder="Gemini API 키 (AIza...)"
                                className="h-11 font-mono text-sm"
                              />
                              <Select value={geminiModel} onValueChange={setGeminiModel}>
                                <SelectTrigger className="h-11 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {MODEL_OPTIONS.map((option) => (
                                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button onClick={handleConnectGemini} disabled={!geminiKeyInput.trim() || geminiTesting} className="h-11 px-5 text-sm">
                                {geminiTesting ? <><Loader2 className="h-4 w-4 animate-spin" />연결 중</> : '연결 테스트'}
                              </Button>
                            </div>
                            <p className="text-[11px] leading-relaxed text-gray-500">키는 현재 브라우저에만 저장되며 PersonaFlow 서버에는 저장되지 않습니다.</p>
                            {geminiError && <p className="text-xs text-red-600">{geminiError}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-[18px] border p-5 ${figmaLinkStepComplete ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : hasApiKey ? 'border-blue-500/40 bg-[#272729]' : 'border-white/8 bg-[#202022] opacity-60'}`}>
                    <div className="flex items-start gap-4">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${figmaLinkStepComplete ? 'bg-emerald-500 text-white' : hasApiKey ? 'bg-blue-500 text-white' : 'bg-white/8 text-white/30'}`}>
                        {figmaLinkStepComplete ? <Check className="h-4 w-4" /> : '2'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-[15px] font-semibold text-gray-900">Figma 프레임 링크</p>
                            <p className="mt-1 text-xs text-gray-500">Figma에서 프레임을 선택한 뒤 Ctrl/⌘ + L로 링크를 복사하세요.</p>
                          </div>
                          {hasConnectedFigmaSource && !editingFigmaLinks && (
                            <button type="button" onClick={() => setEditingFigmaLinks(true)} className="text-xs font-medium text-blue-500 hover:text-blue-400">
                              링크 변경
                            </button>
                          )}
                        </div>

                        {!hasApiKey ? (
                          <p className="mt-4 text-xs text-gray-500">먼저 Gemini AI 연결을 완료하세요.</p>
                        ) : hasConnectedFigmaSource && !editingFigmaLinks ? (
                          <div className="mt-4 rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                            <p className="truncate text-sm font-medium text-gray-800">{figmaConnectionLabel}</p>
                            <p className="mt-1 text-xs text-emerald-400">링크 확인 완료</p>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-2">
                            {figmaLinkRows.map((row, index) => {
                              const canRemove = figmaLinkRows.length > 1 || Boolean(row.url.trim())
                              return (
                                <div key={row.id} className="flex gap-2">
                                  <Input
                                    value={row.url}
                                    onChange={(e) => handleFigmaRowUrlChange(row.id, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleConnectFigma(row.id)
                                    }}
                                    placeholder={index === 0 ? '선택한 Figma 프레임 링크 붙여넣기' : `추가 프레임 링크 ${index + 1}`}
                                    className="h-11 flex-1 text-sm"
                                  />
                                  <Button onClick={() => handleConnectFigma(row.id)} disabled={!row.url.trim()} className="h-11 px-5 text-sm">
                                    링크 확인
                                  </Button>
                                  {canRemove && (
                                    <Button type="button" variant="outline" size="icon" onClick={() => handleRemoveFigmaLinkRow(row.id)} className="h-11 w-11">
                                      <X className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-[18px] border p-5 ${figmaAccessStepComplete ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : figmaLinkStepComplete ? 'border-blue-500/40 bg-[#272729]' : 'border-white/8 bg-[#202022] opacity-60'}`}>
                    <div className="flex items-start gap-4">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${figmaAccessStepComplete ? 'bg-emerald-500 text-white' : figmaLinkStepComplete ? 'bg-blue-500 text-white' : 'bg-white/8 text-white/30'}`}>
                        {figmaAccessStepComplete ? <Check className="h-4 w-4" /> : '3'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-gray-900">Figma 접근 권한</p>
                        <p className="mt-1 text-xs text-gray-500">화면을 읽기 위한 개인 액세스 토큰을 연결합니다.</p>

                        {!figmaLinkStepComplete ? (
                          <p className="mt-4 text-xs text-gray-500">먼저 Gemini 연결과 Figma 프레임 링크 확인을 완료하세요.</p>
                        ) : figmaAccessStepComplete ? (
                          <div className="mt-4 flex items-center justify-between rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-gray-800">접근 권한 연결됨</p>
                              <p className="mt-1 text-xs text-gray-500">토큰은 이 브라우저에만 저장됩니다.</p>
                            </div>
                            <button type="button" onClick={handleClearFigmaToken} className="text-xs font-medium text-blue-500 hover:text-blue-400">권한 변경</button>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-3">
                            <Input
                              type="password"
                              value={figmaToken}
                              onChange={(e) => {
                                setFigmaToken(e.target.value)
                                setFigmaAccessConnected(false)
                                setFigmaError(null)
                              }}
                              placeholder="Figma 개인 액세스 토큰"
                              className="h-11 font-mono text-sm"
                            />
                            <div className="flex items-center justify-between gap-3">
                              <a href="https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens" target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-blue-500">
                                토큰 발급 방법
                              </a>
                              <Button onClick={handleConnectFigmaAccess} disabled={!figmaToken.trim()} className="h-10 px-5 text-sm">
                                권한 연결
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-[18px] border p-5 ${hasFigmaFrameImages ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : figmaAccessStepComplete ? 'border-blue-500/40 bg-[#272729]' : 'border-white/8 bg-[#202022] opacity-60'}`}>
                    <div className="flex items-start gap-4">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${hasFigmaFrameImages ? 'bg-emerald-500 text-white' : figmaAccessStepComplete ? 'bg-blue-500 text-white' : 'bg-white/8 text-white/30'}`}>
                        {hasFigmaFrameImages ? <Check className="h-4 w-4" /> : '4'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-gray-900">분석 화면 가져오기</p>
                        <p className="mt-1 text-xs text-gray-500">AI가 실제로 읽을 화면 이미지를 Figma에서 불러옵니다.</p>

                        {!figmaAccessStepComplete ? (
                          <p className="mt-4 text-xs text-gray-500">먼저 링크 확인과 Figma 접근 권한 연결을 완료하세요.</p>
                        ) : (
                          <div className="mt-4 flex items-center justify-between gap-4 rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-gray-800">
                                {hasFigmaFrameImages ? `${figmaReadyFrames.length}개 화면 준비 완료` : '가져온 화면이 없습니다'}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                {hasFigmaFrameImages ? '아래에서 화면 순서와 대상을 확인하세요.' : '연결한 링크에서 분석 화면을 가져옵니다.'}
                              </p>
                            </div>
                            <Button onClick={handleImportFigmaFrames} disabled={figmaImporting || filledFigmaRows.length === 0} className="h-10 flex-shrink-0 px-5 text-sm">
                              {figmaImporting ? <><Loader2 className="h-4 w-4 animate-spin" />가져오는 중</> : hasFigmaFrameImages ? '다시 불러오기' : '화면 불러오기'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {figmaError && <p className="px-1 text-xs text-red-600">{figmaError}</p>}
                </div>

                {hasFigmaFrameImages && <div>{renderTestModeControl()}</div>}

                {hasFigmaFrameImages && (
                  <div className="space-y-4">
                    {testMode === 'single' ? (
                      frames.length > 0 && (
                        <div className="space-y-3">
                          {renderFrameGrid('single', frames, handleDeleteSingle, commitSingleEdit)}
                          <p className="text-xs text-gray-400">
                            가져온 화면 순서가 테스트 플로우 순서가 됩니다. 필요하면 카드를 드래그해 조정하세요.
                          </p>
                        </div>
                      )
                    ) : (
                      renderFigmaABBuilder()
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-[21px] font-semibold tracking-[-0.015em] text-gray-950">
                      이미지 파일로 테스트
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      기존 PNG/JPG 업로드 방식으로 단일 화면 또는 A/B 화면을 비교합니다.
                    </p>
                  </div>
                </div>

                <div>{renderTestModeControl()}</div>

                {testMode === 'single' ? (
                  <div className="space-y-4">
                    {frames.length === 0 ? (
                      <>
                        {renderEmptyDropZone(
                          'single',
                          handleSingleDrop,
                          'single-upload',
                          '이미지를 드래그하거나 클릭하여 업로드',
                          'PNG, JPG · 최대 10MB'
                        )}
                        <input
                          id="single-upload"
                          type="file"
                          accept="image/png,image/jpeg"
                          multiple
                          className="hidden"
                          onChange={handleSingleFileChange}
                        />
                      </>
                    ) : (
                      <div className="space-y-4">
                        {renderFrameGrid('single', frames, handleDeleteSingle, commitSingleEdit)}
                        {renderAddMore('single', handleSingleDrop, 'single-upload-more')}
                        <input
                          id="single-upload-more"
                          type="file"
                          accept="image/png,image/jpeg"
                          multiple
                          className="hidden"
                          onChange={handleSingleFileChange}
                        />
                        <p className="text-xs text-gray-400">{frames.length}개 화면 업로드됨</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-600">테스트 목적</label>
                        <Input
                          value={abConfig.goal}
                          onChange={(e) => onAbConfigChange({ ...abConfig, goal: e.target.value })}
                          placeholder="예: 가입 전환 가능성이 높은 화면 찾기"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-600">A/B 가설</label>
                        <Input
                          value={abConfig.hypothesis}
                          onChange={(e) =>
                            onAbConfigChange({ ...abConfig, hypothesis: e.target.value })
                          }
                          placeholder="예: B안의 짧은 카피가 더 빠른 이해를 만들 것이다"
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-600">비교 기준</p>
                      <div className="flex flex-wrap gap-2">
                        {CRITERIA_OPTIONS.map((criterion) => {
                          const checked = abConfig.criteria.includes(criterion)
                          return (
                            <button
                              key={criterion}
                              onClick={() => toggleCriterion(criterion)}
                              className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                                checked
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              {criterion}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {variants.map(renderVariantPane)}
                    </div>

                    <p className="text-xs text-gray-400">
                      업로드 순서가 플로우 순서가 됩니다. 카드를 드래그하면 Screen01, Screen02 순서가 자동으로 다시 정렬됩니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="hidden">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500">디자인 가져오기</p>
              <button
                onClick={() => handleSourceTypeChange('figma')}
                className={`w-full rounded-[11px] border p-4 text-left transition-colors ${
                  sourceType === 'figma'
                    ? 'border-blue-500 bg-[#272729] ring-1 ring-blue-500'
                    : 'border-gray-200 bg-transparent hover:bg-[#1c1c1e]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Link className="h-4 w-4" />
                  Figma 연결
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  화면 이미지 가져오기
                </span>
              </button>
              <button
                onClick={() => handleSourceTypeChange('image')}
                className={`w-full rounded-[11px] border p-4 text-left transition-colors ${
                  sourceType === 'image'
                    ? 'border-blue-500 bg-[#272729] ring-1 ring-blue-500'
                    : 'border-gray-200 bg-transparent hover:bg-[#1c1c1e]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Upload className="h-4 w-4" />
                  이미지 업로드
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  PNG/JPG 또는 A/B 비교
                </span>
              </button>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-[#272729] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-900">준비 상태</p>
                  <p className="mt-1 text-[11px] text-gray-500">첫 테스트에 필요한 항목입니다.</p>
                </div>
                <span className="text-xs font-medium text-gray-500">
                  {[sourceReady, hasApiKey].filter(Boolean).length}/2
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${
                      sourceReady ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/8 text-white/30'
                    }`}
                  >
                    {sourceReady ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <div>
                    <p className="text-xs font-medium text-gray-800">디자인 화면</p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {sourceReady ? '준비 완료' : 'Figma 또는 이미지가 필요합니다'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${
                      hasApiKey ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/8 text-white/30'
                    }`}
                  >
                    {hasApiKey ? <Check className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800">Gemini API 키</p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {hasApiKey ? '연결 완료' : 'AI 테스트 실행 전에 필요합니다'}
                    </p>
                  </div>
                  {!hasApiKey && (
                    <button
                      type="button"
                      onClick={onRequireApiKey}
                      className="text-[11px] font-medium text-blue-500 hover:text-blue-400"
                    >
                      설정
                    </button>
                  )}
                </div>
              </div>
            </div>

            {renderAiModeControl()}

            <div className="rounded-[18px] border border-white/10 bg-[#272729] p-5">
              <p className="text-xs font-semibold text-gray-900">현재 선택</p>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">소스</dt>
                  <dd className="font-medium text-gray-900">
                    {sourceType === 'figma' ? 'Figma' : '이미지'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">실행</dt>
                  <dd className="font-medium text-gray-900">
                    실제 AI 분석
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">화면</dt>
                  <dd className="font-medium text-gray-900">
                    {testMode === 'ab'
                      ? variants.reduce((sum, variant) => sum + variant.frames.length, 0)
                      : frames.length}
                    개
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 pb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className={`h-1.5 w-1.5 rounded-full ${canProceed ? 'bg-emerald-400' : 'bg-white/25'}`} />
          {getNextStepHint()}
        </div>
        <Button onClick={onNext} disabled={!canProceed} className="h-11 flex-shrink-0 px-6 text-[15px]">
          페르소나 설정
          <span aria-hidden>→</span>
        </Button>
      </div>
    </div>
  )
}
