import { useState } from 'react'
import { Check, GripVertical, ImageIcon, Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { importFigmaFrames } from '@/lib/figmaApi'
import { testApiKey } from '@/lib/ai/gemini'
import { DEFAULT_BRIDGE_URL, MODEL_OPTIONS } from '@/lib/ai/keyStore'
import {
  clearStoredFigmaToken,
  getStoredFigmaToken,
  storeFigmaToken,
} from '@/lib/figmaAuth'
import { createFigmaFrame, getFigmaSourceLabel, parseFigmaUrl } from '@/lib/figma'
import { getFrameSecondaryLabel, normalizeFrameOrder } from '@/lib/frameNaming'
import type { FigmaSource, Frame } from '@/types'

interface UploadStepProps {
  frames: Frame[]
  onFramesChange: (frames: Frame[]) => void
  figmaUrl: string
  onFigmaUrlChange: (url: string) => void
  figmaSource: FigmaSource | null
  onFigmaSourceChange: (source: FigmaSource | null) => void
  onNext: () => void
  hasApiKey: boolean
  apiKey: string
  model: string
  onSaveApiKey: (key: string, model: string) => void
  onRequireApiKey: () => void
  /** 개발 서버에서만 전달된다. */
  onUseSampleFrames?: () => void
}

type FigmaLinkRow = {
  id: string
  url: string
  source: FigmaSource | null
}

function hasFrameImage(frame: Frame): boolean {
  return Boolean(frame.file || frame.imageUrl)
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
  figmaUrl,
  onFigmaUrlChange,
  figmaSource,
  onFigmaSourceChange,
  onNext,
  hasApiKey,
  apiKey,
  model,
  onSaveApiKey,
  onRequireApiKey,
  onUseSampleFrames,
}: UploadStepProps) {
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null)
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
  const [geminiKeyInput, setGeminiKeyInput] = useState(apiKey || DEFAULT_BRIDGE_URL)
  const [geminiModel, setGeminiModel] = useState(model)
  const [geminiTesting, setGeminiTesting] = useState(false)
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [figmaLinkRows, setFigmaLinkRows] = useState<FigmaLinkRow[]>(() =>
    buildInitialFigmaRows(figmaUrl, figmaSource, frames)
  )

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
            (frame) => !frameMatchesFigmaSource(frame, previousSource)
          )
        )
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
    // 첫 링크를 확인한 뒤에도 입력 영역을 유지해 다음 Flow 화면을 계속 추가한다.
    setEditingFigmaLinks(true)
    setFigmaLinkRows((rows) =>
      ensureTrailingEmptyFigmaRow(
        rows.map((item) => (item.id === rowId ? { ...item, url: source.url, source } : item))
      )
    )

    const nextSourceKey = getFigmaSourceKey(source)
    const nextFrames = frames.some((frame) => getFigmaFrameKey(frame) === nextSourceKey)
      ? frames
      : [...frames, createFigmaFrame(source)]
    onFramesChange(normalizeFrameOrder(nextFrames))
  }

  const handleFinishFigmaLinks = () => {
    const filledRows = getFilledFigmaRows(figmaLinkRows)
    const hasUnconfirmedRow = filledRows.some((row) => !row.source)

    if (filledRows.length === 0 || hasUnconfirmedRow) {
      setFigmaError('입력한 모든 Figma 프레임 링크를 확인해주세요.')
      return
    }

    setFigmaError(null)
    setEditingFigmaLinks(false)
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
        onFramesChange(importedFrames)
      setFigmaLinkRows((rows) =>
        ensureTrailingEmptyFigmaRow(
          rows.map((row) => {
            const imported = importedList.find((item) => item.source.url === row.url.trim())
            return imported ? { ...row, url: imported.source.url, source: imported.source } : row
          })
        )
      )
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
        frames.filter((frame) => !frameMatchesFigmaSource(frame, source))
      )
      onFramesChange(nextFrames)
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
    // 권한 연결 직후 화면을 바로 불러와 '화면 불러오기' 클릭을 한 번 줄인다.
    if (frames.every((frame) => !frame.imageUrl)) void handleImportFigmaFrames()
  }

  const handleConnectGemini = async () => {
    if (!geminiKeyInput.trim()) return
    setGeminiTesting(true)
    setGeminiError(null)
    try {
      await testApiKey(geminiKeyInput.trim(), geminiModel)
      onSaveApiKey(geminiKeyInput.trim(), geminiModel)
    } catch (error) {
      setGeminiError(error instanceof Error ? error.message : '브리지 연결 테스트에 실패했습니다.')
    } finally {
      setGeminiTesting(false)
    }
  }

  const revokeFrameUrl = (frame: Frame) => {
    if (!frame.imageUrl.startsWith('blob:')) return
    URL.revokeObjectURL(frame.imageUrl)
  }

  const handleDeleteFrame = (id: string) => {
    const frame = frames.find((item) => item.id === id)
    if (frame) revokeFrameUrl(frame)
    onFramesChange(normalizeFrameOrder(frames.filter((item) => item.id !== id)))
  }

  const startEdit = (frame: Frame) => {
    setEditingId(frame.id)
    setEditingName(frame.userLabel ?? '')
  }

  const commitEdit = (id: string) => {
    const userLabel = editingName.trim() || undefined
    onFramesChange(
      frames.map((frame) =>
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

  const handleFrameDragStart = (frameId: string, e: React.DragEvent<HTMLDivElement>) => {
    setDraggedFrameId(frameId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/personaflow-frame', frameId)
  }

  const handleFrameDragOver = (frameId: string, e: React.DragEvent<HTMLDivElement>) => {
    if (!draggedFrameId || draggedFrameId === frameId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropFrameId(frameId)
  }

  const handleFrameDrop = (frameId: string, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (draggedFrameId) onFramesChange(reorderFrames(frames, draggedFrameId, frameId))
    setDraggedFrameId(null)
    setDropFrameId(null)
  }

  const handleFrameDragEnd = () => {
    setDraggedFrameId(null)
    setDropFrameId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, commit: () => void) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditingId(null)
  }

  const filledFigmaRows = getFilledFigmaRows(figmaLinkRows)
  const connectedFigmaRows = figmaLinkRows.filter((row) => row.source)
  const hasConnectedFigmaSource = connectedFigmaRows.length > 0 || Boolean(figmaSource)
  // Figma 단계는 브리지와 무관하므로 브리지 연결 전에도 진행할 수 있다.
  const figmaLinkStepComplete = hasConnectedFigmaSource
  const figmaAccessStepComplete = figmaLinkStepComplete && figmaAccessConnected
  const figmaConnectionLabel =
    connectedFigmaRows.length > 1
      ? `${connectedFigmaRows.length}개 Figma 링크 연결됨`
      : figmaSource
      ? getFigmaSourceLabel(figmaSource)
      : connectedFigmaRows[0]?.source
      ? getFigmaSourceLabel(connectedFigmaRows[0].source)
      : 'Figma 연결됨'
  const figmaReadyFrames = frames.filter(hasFrameImage)
  const hasFigmaFrameImages = figmaReadyFrames.length > 0
  const canProceed = Boolean(
    hasConnectedFigmaSource && hasFigmaFrameImages && frames.every(hasFrameImage)
  )

  const getNextStepHint = () => {
    if (!hasConnectedFigmaSource) return '계속하려면 Figma 링크를 연결하세요.'
    if (!figmaAccessConnected) return '계속하려면 Figma 접근 권한을 연결하세요.'
    if (!hasFigmaFrameImages) return '계속하려면 분석할 Figma 화면을 불러오세요.'
    if (!hasApiKey) return '화면 준비 완료. AI 테스트를 실행하기 전까지 Claude 브리지를 연결하세요.'
    return '디자인 준비가 완료되었습니다. 다음 단계에서 미션과 Flow를 설정하세요.'
  }

  const renderFrameGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {frames.map((frame) => (
        <div
          key={frame.id}
          draggable={editingId !== frame.id}
          onDragStart={(e) => handleFrameDragStart(frame.id, e)}
          onDragOver={(e) => handleFrameDragOver(frame.id, e)}
          onDrop={(e) => handleFrameDrop(frame.id, e)}
          onDragEnd={handleFrameDragEnd}
          className={`bg-white rounded-md border overflow-hidden group transition ${
            dropFrameId === frame.id
              ? 'border-blue-400 ring-2 ring-blue-100'
              : 'border-gray-200'
          } ${draggedFrameId === frame.id ? 'opacity-60' : ''}`}
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
              onClick={() => handleDeleteFrame(frame.id)}
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
                  onKeyDown={(e) => handleEditKeyDown(e, () => commitEdit(frame.id))}
                  onBlur={() => commitEdit(frame.id)}
                  placeholder={frame.originalName ?? '화면 역할 입력'}
                  className="h-6 text-xs px-1.5"
                  autoFocus
                />
                <button
                  onClick={() => commitEdit(frame.id)}
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

  return (
    <div className="mx-auto max-w-[1180px] space-y-8">
      <div>
        <div>
          <p className="text-sm font-medium text-blue-600">새로운 UX 테스트</p>
          <h2 className="mt-2 text-[34px] font-semibold leading-tight tracking-[-0.025em] text-gray-950">
            테스트할 디자인을 가져오세요.
          </h2>
          <p className="mt-2 text-[17px] leading-relaxed text-gray-500">
            Figma 프레임 링크를 연결하면 AI 페르소나가 그 화면으로 테스트합니다.
          </p>
        </div>
      </div>

      {onUseSampleFrames && (
        <div className="flex items-center justify-between gap-4 rounded-[18px] border border-dashed border-amber-400/40 bg-amber-400/[0.06] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-amber-300">개발용 · 샘플 화면으로 시작</p>
            <p className="mt-1 text-xs text-gray-500">
              Figma 토큰 없이 샘플 화면 6개로 미션·페르소나·실행 단계를 점검합니다. 배포 사이트에는 보이지 않습니다.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onUseSampleFrames} className="h-9 flex-shrink-0 px-4 text-xs">
            샘플 화면 사용
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#1c1c1e]">
        <div className="grid grid-cols-1">
          <section className="space-y-7 p-7 sm:p-8">
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
                    <p className="text-[15px] font-semibold text-gray-900">Claude 브리지 연결</p>
                    <p className="mt-1 text-xs text-gray-500">내 맥에서 실행 중인 브리지를 통해 Claude 구독 계정으로 분석합니다.</p>

                    {hasApiKey ? (
                      <div className="mt-4 flex items-center justify-between rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">Claude 브리지 연결 완료</p>
                          <p className="mt-1 text-xs text-gray-500">{MODEL_OPTIONS.find((option) => option.id === model)?.label ?? model}</p>
                        </div>
                        <button type="button" onClick={onRequireApiKey} className="text-xs font-medium text-blue-500 hover:text-blue-400">연결 변경</button>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <p className="text-xs leading-relaxed text-gray-500">
                          터미널에서 persona-flow 폴더로 이동해 <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-gray-800">npm run bridge</code>를 실행한 뒤 연결 테스트를 누르세요.
                        </p>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_260px_auto]">
                          <Input
                            value={geminiKeyInput}
                            onChange={(event) => {
                              setGeminiKeyInput(event.target.value)
                              setGeminiError(null)
                            }}
                            placeholder={DEFAULT_BRIDGE_URL}
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
                        <p className="text-[11px] leading-relaxed text-gray-500">Claude 호출은 내 맥의 브리지에서만 처리되며, 구독 로그인 정보는 이 컴퓨터 밖으로 나가지 않습니다.</p>
                        {geminiError && <p className="text-xs text-red-600">{geminiError}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={`rounded-[18px] border p-5 ${figmaLinkStepComplete ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-blue-500/80 bg-[#272729]'}`}>
                <div className="flex items-start gap-4">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${figmaLinkStepComplete ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-blue-500 bg-blue-500 text-white'}`}>
                    {figmaLinkStepComplete ? <Check className="h-4 w-4" /> : '2'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[15px] font-semibold text-gray-900">Figma 프레임 링크</p>
                        <p className="mt-1 text-xs text-gray-500">
                          화면마다 프레임 링크를 하나씩 추가하세요. 첫 링크 확인 후 다음 입력칸이 자동으로 열립니다.
                        </p>
                      </div>
                      {hasConnectedFigmaSource && !editingFigmaLinks && (
                        <button type="button" onClick={() => setEditingFigmaLinks(true)} className="text-xs font-medium text-blue-500 hover:text-blue-400">
                          화면 추가·관리
                        </button>
                      )}
                    </div>

                    {hasConnectedFigmaSource && !editingFigmaLinks ? (
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
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-white/8 bg-black/15 px-4 py-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-800">
                              {connectedFigmaRows.length}개 화면 링크 확인됨
                            </p>
                            <p className="mt-1 text-[11px] text-gray-500">
                              Flow에 필요한 화면을 모두 추가한 뒤 입력 완료를 눌러주세요.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleFinishFigmaLinks}
                            disabled={connectedFigmaRows.length === 0}
                            className="h-9 px-4 text-xs"
                          >
                            입력 완료
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={`rounded-[18px] border p-5 ${figmaAccessStepComplete ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : figmaLinkStepComplete ? 'border-blue-500/80 bg-[#272729]' : 'border-gray-200 bg-[#18181a]'}`}>
                <div className="flex items-start gap-4">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${figmaAccessStepComplete ? 'border-emerald-500 bg-emerald-500 text-white' : figmaLinkStepComplete ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-gray-100 text-gray-500'}`}>
                    {figmaAccessStepComplete ? <Check className="h-4 w-4" /> : '3'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-gray-900">Figma 접근 권한</p>
                    <p className="mt-1 text-xs text-gray-500">화면을 읽기 위한 개인 액세스 토큰을 연결합니다.</p>

                    {!figmaLinkStepComplete ? (
                      <p className="mt-4 text-xs text-gray-500">먼저 Figma 프레임 링크 확인을 완료하세요.</p>
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

              <div className={`rounded-[18px] border p-5 ${hasFigmaFrameImages ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : figmaAccessStepComplete ? 'border-blue-500/80 bg-[#272729]' : 'border-gray-200 bg-[#18181a]'}`}>
                <div className="flex items-start gap-4">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${hasFigmaFrameImages ? 'border-emerald-500 bg-emerald-500 text-white' : figmaAccessStepComplete ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-gray-100 text-gray-500'}`}>
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

            {hasFigmaFrameImages && frames.length > 0 && (
              <div className="space-y-3">
                {renderFrameGrid()}
                <p className="text-xs text-gray-400">
                  가져온 화면 순서가 테스트 플로우 순서가 됩니다. 필요하면 카드를 드래그해 조정하세요.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 pb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className={`h-1.5 w-1.5 rounded-full ${canProceed ? 'bg-emerald-400' : 'bg-white/25'}`} />
          {getNextStepHint()}
        </div>
        <Button onClick={onNext} disabled={!canProceed} className="h-11 flex-shrink-0 px-6 text-[15px]">
          미션과 Flow 설정
          <span aria-hidden>→</span>
        </Button>
      </div>
    </div>
  )
}
