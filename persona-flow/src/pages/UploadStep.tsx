import { useCallback, useState } from 'react'
import {
  Check,
  GitCompare,
  GripVertical,
  ImageIcon,
  Pencil,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getFrameSecondaryLabel,
  normalizeFrameOrder,
  stripFileExtension,
} from '@/lib/frameNaming'
import type { ABTestConfig, DesignVariant, Frame, TestMode, VariantId } from '@/types'

interface UploadStepProps {
  frames: Frame[]
  onFramesChange: (frames: Frame[]) => void
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

export default function UploadStep({
  frames,
  onFramesChange,
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

  const variantA = variants.find((variant) => variant.id === 'A')
  const variantB = variants.find((variant) => variant.id === 'B')
  const canProceed =
    testMode === 'single'
      ? frames.length > 0
      : Boolean(variantA?.frames.length && variantB?.frames.length)

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

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">시안 업로드</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          단일 시안 분석 또는 A/B 화면 비교 테스트를 선택하세요.
        </p>
      </div>

      <div className="inline-flex rounded-md border border-gray-200 bg-white p-1">
        <button
          onClick={() => onTestModeChange('single')}
          className={`px-4 py-2 text-xs font-semibold rounded transition-colors ${
            testMode === 'single'
              ? 'bg-slate-900 text-white'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          단일 시안 테스트
        </button>
        <button
          onClick={() => onTestModeChange('ab')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded transition-colors ${
            testMode === 'ab'
              ? 'bg-slate-900 text-white'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <GitCompare className="w-3.5 h-3.5" />
          화면 A/B 테스트
        </button>
      </div>

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                onChange={(e) => onAbConfigChange({ ...abConfig, hypothesis: e.target.value })}
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
                    className={`text-xs px-3 py-1.5 rounded border font-medium transition-colors ${
                      checked
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {criterion}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {variants.map(renderVariantPane)}
          </div>

          <p className="text-xs text-gray-400">
            업로드 순서가 플로우 순서가 됩니다. 카드를 드래그하면 Screen01, Screen02 순서가 자동으로 다시 정렬됩니다.
          </p>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={onNext} disabled={!canProceed} size="sm" className="px-6">
          다음 단계 →
        </Button>
      </div>
    </div>
  )
}
