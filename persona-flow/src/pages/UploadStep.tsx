import { useCallback, useState } from 'react'
import {
  ChevronDown,
  Check,
  GitCompare,
  GripVertical,
  ImageIcon,
  KeyRound,
  Link,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { importFigmaFrames } from '@/lib/figmaApi'
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
}

const CRITERIA_OPTIONS = ['첫인상', '이해도', '전환 유도', '탐색 흐름', '신뢰감']

type DragScope = 'single' | VariantId
type DraggedFrame = { scope: DragScope; frameId: string }

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
}: UploadStepProps) {
  const [dragTarget, setDragTarget] = useState<'single' | VariantId | null>(null)
  const [draggedFrame, setDraggedFrame] = useState<DraggedFrame | null>(null)
  const [dropFrameId, setDropFrameId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [figmaError, setFigmaError] = useState<string | null>(null)
  const [figmaToken, setFigmaToken] = useState(() => getStoredFigmaToken())
  const [figmaImporting, setFigmaImporting] = useState(false)
  const [showFigmaAdvanced, setShowFigmaAdvanced] = useState(() => Boolean(getStoredFigmaToken()))

  const handleSourceTypeChange = (nextSourceType: SourceType) => {
    onSourceTypeChange(nextSourceType)
    setFigmaError(null)
    if (nextSourceType === 'figma') {
      setShowFigmaAdvanced(true)
      const figmaFrames = frames.filter((frame) => frame.sourceType === 'figma')
      if (figmaFrames.length > 0) {
        onFramesChange(normalizeFrameOrder(figmaFrames))
        if (testMode === 'ab') {
          onVariantsChange(splitFramesIntoVariants(figmaFrames, variants))
        }
      } else if (figmaSource) {
        onFramesChange([createFigmaFrame(figmaSource)])
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

  const handleConnectFigma = () => {
    const source = parseFigmaUrl(figmaUrl)
    if (!source) {
      setFigmaError('Figma 파일, 디자인, 프로토타입 링크를 입력해주세요.')
      onFigmaSourceChange(null)
      return
    }

    setFigmaError(null)
    onFigmaSourceChange(source)
    onSourceTypeChange('figma')
    setShowFigmaAdvanced(true)
    onFramesChange([createFigmaFrame(source)])
    if (testMode === 'ab') {
      onVariantsChange(variants.map((variant) => ({ ...variant, frames: [] })))
    }
  }

  const handleImportFigmaFrames = async () => {
    const source = parseFigmaUrl(figmaUrl)
    if (!source) {
      setFigmaError('Figma 파일, 디자인, 프로토타입 링크를 입력해주세요.')
      onFigmaSourceChange(null)
      return
    }

    setFigmaImporting(true)
    setFigmaError(null)

    try {
      storeFigmaToken(figmaToken)
      const imported = await importFigmaFrames(source, figmaToken)
      const importedFrames = normalizeFrameOrder(imported.frames)
      onFigmaSourceChange(imported.source)
      onSourceTypeChange('figma')
      onFramesChange(importedFrames)
      if (testMode === 'ab') {
        onVariantsChange(splitFramesIntoVariants(importedFrames, variants))
      }
    } catch (e) {
      setFigmaError(e instanceof Error ? e.message : 'Figma 화면 이미지를 가져오지 못했습니다.')
      onFigmaSourceChange(source)
      onFramesChange([createFigmaFrame(source)])
      if (testMode === 'ab') {
        onVariantsChange(variants.map((variant) => ({ ...variant, frames: [] })))
      }
    } finally {
      setFigmaImporting(false)
    }
  }

  const handleClearFigmaToken = () => {
    clearStoredFigmaToken()
    setFigmaToken('')
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
  const figmaReadyFrames = frames.filter((frame) => frame.sourceType === 'figma' && hasFrameImage(frame))
  const hasFigmaFrameImages = sourceType === 'figma' && figmaReadyFrames.length > 0
  const abFrames = variants.flatMap((variant) => variant.frames)
  const hasABFrames = Boolean(variantA?.frames.length && variantB?.frames.length)
  const hasReadyABFrames = hasABFrames && abFrames.every(hasFrameImage)
  const canProceed =
    testMode === 'single'
      ? sourceType === 'figma'
        ? Boolean(figmaSource && hasFigmaFrameImages && frames.every(hasFrameImage))
        : frames.length > 0
      : sourceType === 'figma'
      ? Boolean(figmaSource && hasReadyABFrames)
      : hasReadyABFrames

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
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-gray-900">실행 모드</p>
        <span className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
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
    <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
      <button
        onClick={() => handleTestModeChange('single')}
        className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
          testMode === 'single'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        단일 시안
      </button>
      <button
        onClick={() => handleTestModeChange('ab')}
        className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
          testMode === 'ab'
            ? 'bg-white text-gray-900 shadow-sm'
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
        border border-dashed rounded-md transition-colors cursor-pointer
        flex flex-col items-center justify-center gap-3 py-14
        ${dragTarget === target ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'}
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
        border border-dashed rounded-md transition-colors cursor-pointer
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
    <div key={variant.id} className="border border-gray-200 rounded-md bg-white p-4 space-y-4">
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
    <div key={variant.id} className="border border-gray-200 rounded-md bg-white p-4 space-y-4">
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
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            New test
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-950">
            어떤 디자인을 테스트할까요?
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Figma 또는 이미지 화면으로 실제 AI 페르소나 테스트를 준비하세요.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          기존 이미지 업로드 기능은 그대로 유지됩니다
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]">
          <section className="space-y-5 p-5 sm:p-6">
            {sourceType === 'figma' ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                    <Link className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-950">
                      Figma 링크로 시작
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Figma 파일, 선택 화면, 프로토타입 링크를 붙여넣어 테스트 소스로 연결합니다.
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={figmaUrl}
                      onChange={(e) => {
                        onFigmaUrlChange(e.target.value)
                        setFigmaError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConnectFigma()
                      }}
                      placeholder="Figma 링크 붙여넣기"
                      className="h-11 bg-white text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleConnectFigma}
                      className="h-11 px-5 text-sm"
                    >
                      링크 연결
                    </Button>
                  </div>

                  <button
                    onClick={() => setShowFigmaAdvanced(!showFigmaAdvanced)}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        showFigmaAdvanced ? 'rotate-180' : ''
                      }`}
                    />
                    실제 AI용 Figma 화면 이미지 가져오기
                  </button>

                  {showFigmaAdvanced && (
                    <div className="mt-3 space-y-2">
                      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-900">
                        여기에 넣는 값은 Figma 계정에서 발급한 <b>개인 액세스 토큰</b>입니다.
                        Codex나 Figma 플러그인 설정값이 아닙니다.
                        실제 AI가 화면을 읽으려면 이 토큰으로 Figma 화면 이미지를 가져와야 합니다.
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
                        <Input
                          type="password"
                          value={figmaToken}
                          onChange={(e) => {
                            setFigmaToken(e.target.value)
                            setFigmaError(null)
                          }}
                          placeholder="Figma 개인 액세스 토큰"
                          className="h-9 bg-white font-mono text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={handleImportFigmaFrames}
                          disabled={figmaImporting}
                          className="h-9 px-4"
                        >
                          {figmaImporting ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              가져오는 중
                            </>
                          ) : (
                            '화면 이미지 가져오기'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearFigmaToken}
                          disabled={!figmaToken}
                          className="h-9 px-3"
                        >
                          저장된 토큰 삭제
                        </Button>
                      </div>
                    </div>
                  )}

                  {figmaError && <p className="mt-3 text-xs text-red-600">{figmaError}</p>}
                  {figmaSource && !hasFigmaFrameImages && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                      실제 AI 분석을 하려면 Figma 화면 이미지가 필요합니다. 위 영역에서
                      Figma 개인 액세스 토큰으로 화면 이미지를 먼저 가져오세요.
                    </div>
                  )}
                </div>

                <div>{renderTestModeControl()}</div>

                {figmaSource ? (
                  <div className="space-y-4">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs font-semibold text-emerald-900">
                        {hasFigmaFrameImages ? '화면 이미지 가져오기 완료' : '링크 연결됨'}
                      </p>
                      <p className="mt-1 break-all text-xs text-emerald-800">
                        {getFigmaSourceLabel(figmaSource)}
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80">
                        {hasFigmaFrameImages
                          ? `${figmaReadyFrames.length}개 화면 이미지를 테스트 소스로 가져왔습니다.`
                          : '실제 AI 분석은 아직 실행할 수 없습니다. 위에서 Figma 화면 이미지를 먼저 가져오세요.'}
                      </p>
                    </div>

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
                ) : (
                  <div className="rounded-md border border-dashed border-gray-300 py-12 text-center">
                    <Link className="mx-auto mb-3 h-7 w-7 text-gray-300" />
                    <p className="text-sm font-medium text-gray-700">Figma 링크를 붙여넣으세요</p>
                    <p className="mt-1 text-xs text-gray-400">
                      실제 AI 분석은 Figma 화면 이미지와 Gemini 무료 API 키가 필요합니다.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-950">
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

          <aside className="space-y-4 border-t border-gray-200 bg-gray-50 p-5 lg:border-l lg:border-t-0">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500">입력 방식</p>
              <button
                onClick={() => handleSourceTypeChange('figma')}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  sourceType === 'figma'
                    ? 'border-slate-900 bg-white shadow-sm'
                    : 'border-gray-200 bg-transparent hover:bg-white'
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
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  sourceType === 'image'
                    ? 'border-slate-900 bg-white shadow-sm'
                    : 'border-gray-200 bg-transparent hover:bg-white'
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

            {renderAiModeControl()}

            <div className="rounded-md border border-gray-200 bg-white p-3">
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

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed} size="sm" className="h-10 px-6">
          다음 단계 →
        </Button>
      </div>
    </div>
  )
}
