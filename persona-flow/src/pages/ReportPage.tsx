import { useState } from 'react'
import {
  Send,
  Download,
  FileJson,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Route,
  Target,
  MousePointerClick,
  Gauge,
  Split,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { chatWithPersona } from '@/lib/ai/gemini'
import { getFrameDisplayName } from '@/lib/frameNaming'
import type {
  TestReport,
  ClarificationRequest,
  DesignerAnswer,
  Finding,
  SeverityLevel,
  WalkEmotion,
  ChatMessage,
  FeedbackThread,
  FlowOutcome,
} from '@/types'

interface ReportPageProps {
  report: TestReport
  onNewTest: () => void
  apiKey: string
  model: string
  onRequireKey: () => void
  onFeedbackThreadsChange: (threads: FeedbackThread[]) => void
  onClarificationsChange: (clarifications: ClarificationRequest[]) => void
}

/* ── 유틸 ── */
const severityLabel: Record<SeverityLevel, string> = {
  critical: 'Critical',
  warning: 'Warning',
  suggestion: 'Suggestion',
}

const severityBadgeClass: Record<SeverityLevel, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  suggestion: 'bg-blue-100 text-blue-700',
}

function scoreColor(score: number) {
  if (score <= 40) return 'text-red-600'
  if (score <= 60) return 'text-amber-500'
  if (score <= 80) return 'text-blue-600'
  return 'text-green-600'
}

function scoreBarColor(score: number) {
  if (score <= 40) return '[&>div]:bg-red-500'
  if (score <= 60) return '[&>div]:bg-amber-400'
  if (score <= 80) return '[&>div]:bg-blue-500'
  return '[&>div]:bg-green-500'
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder > 0 ? `${minutes}분 ${remainder}초` : `${minutes}분`
}

function frameNameFromReport(report: TestReport, frameId: string): string {
  const frame = report.frames.find((item) => item.id === frameId)
  return frame ? getFrameDisplayName(frame) : frameId
}

const DIGITAL_LABEL: Record<string, string> = {
  beginner: '초급',
  intermediate: '중급',
  expert: '고급',
}

const EMOTION_META: Record<WalkEmotion, { label: string; cls: string; emoji: string }> = {
  positive: { label: '만족', cls: 'bg-green-50 border-green-200 text-green-700', emoji: '😊' },
  neutral: { label: '보통', cls: 'bg-gray-50 border-gray-200 text-gray-600', emoji: '😐' },
  confused: { label: '혼란', cls: 'bg-amber-50 border-amber-200 text-amber-700', emoji: '😕' },
  frustrated: { label: '불만', cls: 'bg-red-50 border-red-200 text-red-700', emoji: '😣' },
}

const VERIFICATION_META = {
  verified: { label: '화면 근거 일치', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  partial: { label: '부분 근거', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  unverified: { label: '근거 부족', cls: 'border-gray-200 bg-gray-50 text-gray-500' },
} as const

/* ── 탭1 요약 ── */
function SummaryTab({ report }: { report: TestReport }) {
  const criticalCount = report.findings.filter((f) => f.severity === 'critical').length
  const warningCount = report.findings.filter((f) => f.severity === 'warning').length
  const suggestionCount = report.findings.filter((f) => f.severity === 'suggestion').length

  return (
    <div className="space-y-5">
      {report.validation && (
        <div className="overflow-hidden rounded-md border border-blue-200 bg-blue-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">분석 근거 검증</p>
              <p className="mt-1 text-xs text-blue-700">
                화면 ID, Figma 원문, 이미지 판독 결과를 로컬 규칙으로 교차 확인했습니다.
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-blue-700">{report.validation.score}</p>
              <p className="text-[11px] text-blue-600">근거 신뢰 점수 / 100</p>
            </div>
          </div>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">검증된 발견점</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800">
                {report.validation.verifiedFindings} / {report.validation.totalFindings}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">검증된 행동 단계</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800">
                {report.validation.verifiedWalkthroughSteps} / {report.validation.totalWalkthroughSteps}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">구조 데이터 포함 화면</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800">
                {report.validation.inputCoverage.metadataFrames} / {report.validation.inputCoverage.totalFrames}
              </p>
            </div>
          </div>
          {report.validation.warnings.length > 0 && (
            <div className="border-t border-blue-100 px-4 py-3">
              {report.validation.warnings.map((warning) => (
                <p key={warning} className="flex gap-2 text-xs leading-relaxed text-gray-600">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2열 레이아웃: 6축 점수(좌) + 태스크 지표(우) */}
      <div className="grid grid-cols-3 gap-4">
        {/* 6축 점수 (좌측 2/3) */}
        <div className="col-span-2 border border-gray-200 rounded-md bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">6축 UX 평가 점수</h3>
          </div>
          <div className="p-4 space-y-3">
            {report.axisScores.map((axis) => (
              <div key={axis.axis} className="grid grid-cols-[1fr_3fr_2rem] gap-3 items-center">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm">{axis.icon}</span>
                  <span className="text-xs text-gray-600 truncate">{axis.label}</span>
                </div>
                <Progress value={axis.score} className={`h-1.5 ${scoreBarColor(axis.score)}`} />
                <span className={`text-xs font-bold text-right ${scoreColor(axis.score)}`}>
                  {axis.score}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 태스크 지표 (우측 1/3) */}
        <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">AI 시뮬레이션 지표</h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <p className="text-2xl font-bold text-blue-600">{report.taskMetrics.completionRate}%</p>
              <p className="text-xs text-gray-500 mt-0.5">태스크 완료율</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-indigo-600">{report.taskMetrics.avgClicks}</p>
              <p className="text-xs text-gray-500 mt-0.5">평균 클릭 수</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-500">{report.taskMetrics.errorRate}%</p>
              <p className="text-xs text-gray-500 mt-0.5">오류율</p>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-600 break-keep">{report.taskMetrics.dropoffPoint}</p>
              <p className="text-xs text-gray-500 mt-0.5">주요 이탈 지점</p>
            </div>
            {report.taskMetrics.disclaimer && (
              <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
                {report.taskMetrics.disclaimer}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 전체 총평 */}
      <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">전체 총평</h3>
          <div className="flex gap-1.5">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${severityBadgeClass.critical}`}>
              Critical {criticalCount}건
            </span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${severityBadgeClass.warning}`}>
              Warning {warningCount}건
            </span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${severityBadgeClass.suggestion}`}>
              Suggestion {suggestionCount}건
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700 leading-relaxed">{report.overallSummary}</p>
        </div>
      </div>

      {/* 테스트 페르소나 */}
      <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">테스트 페르소나</h3>
        </div>
        <div className="px-4 py-3 flex gap-3 flex-wrap">
          {report.personas.map((persona) => (
            <div
              key={persona.id}
              className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-gray-50"
            >
              <span className="text-base">{persona.avatar ?? '👤'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{persona.name}</p>
                <p className="text-xs text-gray-500">
                  {persona.role} · {DIGITAL_LABEL[persona.digitalLevel] ?? persona.digitalLevel}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 탭2 발견된 문제 ── */
type FilterType = 'all' | SeverityLevel

function FindingRow({ finding, frameName }: { finding: Finding; frameName?: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* 행 헤더 */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 심각도 배지 */}
        <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${severityBadgeClass[finding.severity]}`}>
          {severityLabel[finding.severity]}
        </span>

        {/* 축 */}
        <span className="text-xs text-gray-500 flex-shrink-0 w-24">
          축 {finding.axis}: {finding.axisLabel}
        </span>

        {/* 문제 요약 */}
        <span className="flex-1 text-sm text-gray-800 truncate">{finding.problem}</span>

        {/* 펼침 아이콘 */}
        <span className="flex-shrink-0 text-gray-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* 펼침 영역 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 bg-gray-50 border-t border-gray-100">
          <div className="pt-3">
            <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded font-medium">
              {finding.heuristic}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">태스크 지표</p>
              <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded px-3 py-2">{finding.taskMetric}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">개선 제안</p>
              <p className="text-sm text-gray-700 bg-white border border-green-200 rounded px-3 py-2">{finding.suggestion}</p>
            </div>
          </div>

          {finding.evidence && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-blue-700">화면 근거</p>
                  {finding.verification && (
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERIFICATION_META[finding.verification].cls}`}>
                      {VERIFICATION_META[finding.verification].label}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium text-gray-500">
                  {finding.confidence !== undefined ? `검증 후 확신 ${finding.confidence}%` : ''}
                </span>
              </div>
              <p className="rounded border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm text-gray-700">
                {finding.evidence}
              </p>
              {finding.matchedEvidence && finding.matchedEvidence.length > 0 && (
                <p className="mt-1 text-[11px] text-emerald-700">
                  일치한 원문: {finding.matchedEvidence.map((item) => `“${item}”`).join(', ')}
                </p>
              )}
            </div>
          )}

          {finding.frameId && (
            <p className="text-xs text-gray-400">
              관련 화면: <span className="font-medium text-gray-600">{frameName ?? finding.frameId}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function FindingsTab({ report }: { report: TestReport }) {
  const [filter, setFilter] = useState<FilterType>('all')
  const findings = report.findings

  const filtered = filter === 'all' ? findings : findings.filter((f) => f.severity === filter)

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: `전체 (${findings.length})` },
    { key: 'critical', label: `Critical (${findings.filter((f) => f.severity === 'critical').length})` },
    { key: 'warning', label: `Warning (${findings.filter((f) => f.severity === 'warning').length})` },
    { key: 'suggestion', label: `Suggestion (${findings.filter((f) => f.severity === 'suggestion').length})` },
  ]

  return (
    <div className="space-y-4">
      {/* 필터 라디오 버튼 스타일 */}
      <div className="flex gap-1">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
              filter === opt.key
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 테이블 형태 */}
      <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
        {/* 테이블 헤더 */}
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 flex-shrink-0 w-20">심각도</span>
          <span className="text-xs font-semibold text-gray-500 flex-shrink-0 w-24">평가 축</span>
          <span className="text-xs font-semibold text-gray-500 flex-1">문제 내용</span>
          <span className="w-4" />
        </div>

        {filtered.length > 0 ? (
          filtered.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              frameName={
                finding.frameId ? frameNameFromReport(report, finding.frameId) : undefined
              }
            />
          ))
        ) : (
          <div className="text-center py-10 text-gray-400">
            <p className="text-sm">해당 심각도의 발견 항목이 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 탭3 인라인 채팅 ── */
type ChatMap = Record<string, ChatMessage[]>

const THREAD_SEPARATOR = '::'

function getThreadKey(frameId: string, personaId: string) {
  return `${frameId}${THREAD_SEPARATOR}${personaId}`
}

function chatMapFromThreads(threads: FeedbackThread[] = []): ChatMap {
  return threads.reduce<ChatMap>((acc, thread) => {
    acc[getThreadKey(thread.frameId, thread.personaId)] = thread.messages
    return acc
  }, {})
}

function chatThreadsFromMap(chatMap: ChatMap): FeedbackThread[] {
  return Object.entries(chatMap)
    .filter(([, messages]) => messages.length > 0)
    .map(([key, messages]) => {
      const [frameId, personaId] = key.split(THREAD_SEPARATOR)
      const latestMessage = messages[messages.length - 1]
      return {
        id: key,
        frameId,
        personaId,
        messages,
        updatedAt: latestMessage?.timestamp ?? new Date(),
      }
    })
    .filter((thread) => Boolean(thread.frameId && thread.personaId))
}

function appendChatMessage(chatMap: ChatMap, chatKey: string, message: ChatMessage): ChatMap {
  return {
    ...chatMap,
    [chatKey]: [...(chatMap[chatKey] ?? []), message],
  }
}

function createChatMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `msg-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
    role,
    content,
    timestamp: new Date(),
  }
}

const QUICK_QUESTIONS = [
  '이 버튼 레이블이 직관적해?',
  '첫 번째로 클릭할 것 같은 게 뭐야?',
  '비전공자가 이 용어 이해할 수 있을까?',
]

function InlineChatTab({
  report,
  apiKey,
  model,
  onRequireKey,
  onFeedbackThreadsChange,
}: {
  report: TestReport
  apiKey: string
  model: string
  onRequireKey: () => void
  onFeedbackThreadsChange: (threads: FeedbackThread[]) => void
}) {
  const frames =
    report.frames.length > 0
      ? report.frames
      : report.frameChats.map((fc, i) => ({
          id: fc.frameId,
          name: `화면 ${i + 1} (${fc.frameId})`,
          imageUrl: '',
        }))

  const [selectedFrameId, setSelectedFrameId] = useState(frames[0]?.id ?? '')
  const [selectedPersonaId, setSelectedPersonaId] = useState(report.personas[0]?.id ?? '')
  const [chatMap, setChatMap] = useState<ChatMap>(() =>
    chatMapFromThreads(report.feedbackThreads)
  )
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chatKey = getThreadKey(selectedFrameId, selectedPersonaId)
  const messages: ChatMessage[] = chatMap[chatKey] ?? []
  const currentPersona = report.personas.find((p) => p.id === selectedPersonaId) ?? report.personas[0]

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return
    if (!apiKey) {
      onRequireKey()
      return
    }
    if (!currentPersona) return

    setError(null)
    const history = chatMap[chatKey] ?? []

    const userMsg = createChatMessage('user', text.trim())
    const nextWithUser = appendChatMessage(chatMap, chatKey, userMsg)

    setChatMap(nextWithUser)
    onFeedbackThreadsChange(chatThreadsFromMap(nextWithUser))
    setInput('')
    setIsTyping(true)

    const frame = frames.find((item) => item.id === selectedFrameId) ?? null
    const frameDisplayName = frame ? getFrameDisplayName(frame) : ''
    const chatFrame = frame
      ? {
          ...frame,
          name: frameDisplayName,
          originalName: undefined,
          userLabel: undefined,
        }
      : null

    try {
      const response = await chatWithPersona(
        apiKey,
        model,
        chatFrame,
        currentPersona,
        history,
        text.trim()
      )
      const personaMsg = createChatMessage('persona', response)
      const nextWithPersona = appendChatMessage(nextWithUser, chatKey, personaMsg)
      setChatMap(nextWithPersona)
      onFeedbackThreadsChange(chatThreadsFromMap(nextWithPersona))
    } catch (e) {
      setError(e instanceof Error ? e.message : '응답 생성에 실패했습니다.')
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="space-y-4">
      {/* 화면 + 페르소나 선택 */}
      <div className="flex items-center gap-6 flex-wrap">
        {frames.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">화면</label>
            <select
              value={selectedFrameId}
              onChange={(e) => setSelectedFrameId(e.target.value)}
              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {frames.map((frame) => (
                <option key={frame.id} value={frame.id}>
                  {getFrameDisplayName(frame)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">페르소나</label>
          <div className="flex gap-1">
            {report.personas.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPersonaId(p.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  selectedPersonaId === p.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span>{p.avatar ?? '👤'}</span>
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
        {/* 현재 페르소나 헤더 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-lg">{currentPersona?.avatar ?? '👤'}</span>
          <div>
            <p className="text-xs font-semibold text-gray-800">
              {currentPersona?.name} ({currentPersona?.role})
            </p>
            <p className="text-xs text-gray-400">{currentPersona?.context}</p>
          </div>
        </div>

        {/* 메시지 */}
        <div className="h-72 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm">페르소나에게 질문해보세요</p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'persona' && (
                <span className="text-base mr-2 self-end mb-0.5">
                  {currentPersona?.avatar ?? '👤'}
                </span>
              )}
              <div
                className={`max-w-[75%] px-3 py-2 rounded text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-gray-100 text-gray-800 border border-gray-200'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <span className="text-base mr-2">{currentPersona?.avatar ?? '👤'}</span>
              <div className="bg-gray-100 border border-gray-200 rounded px-3 py-2">
                <span className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="px-4 pt-2">
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 leading-relaxed">
              {error}
            </p>
          </div>
        )}

        {/* 빠른 질문 */}
        <div className="flex gap-1.5 flex-wrap px-4 pb-2 pt-2 border-t border-gray-100">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              disabled={isTyping}
              className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>

        {/* 입력 */}
        <div className="flex gap-2 items-end px-4 pb-4 pt-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="페르소나에게 질문하세요... (Enter로 전송)"
            className="resize-none min-h-[40px] max-h-24 flex-1 text-sm"
            rows={1}
          />
          <Button
            size="icon"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            className="flex-shrink-0 h-10 w-10"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── 탭4 AI 클릭 시뮬레이션 ── */
function WalkthroughTab({ report }: { report: TestReport }) {
  const steps = report.walkthrough ?? []
  const frameName = (id: string) => frameNameFromReport(report, id)

  if (steps.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-sm">시뮬레이션 데이터가 없습니다.</p>
      </div>
    )
  }

  // 페르소나별 그룹화
  const byPersona = new Map<string, typeof steps>()
  for (const s of steps) {
    const arr = byPersona.get(s.personaName) ?? []
    arr.push(s)
    byPersona.set(s.personaName, arr)
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        각 페르소나가 시안을 직접 사용하며 클릭·탐색한 과정을 AI가 시뮬레이션한 결과입니다.
      </p>
      {Array.from(byPersona.entries()).map(([personaName, personaSteps]) => {
        const persona = report.personas.find((p) => p.name === personaName)
        return (
          <div
            key={personaName}
            className="border border-gray-200 rounded-md bg-white overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
              <span className="text-lg">{persona?.avatar ?? '👤'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{personaName}</p>
                {persona && <p className="text-xs text-gray-400">{persona.role}</p>}
              </div>
            </div>
            <div className="p-4">
              <ol className="space-y-3">
                {personaSteps.map((step, i) => {
                  const emo = EMOTION_META[step.emotion]
                  return (
                    <li key={i} className="flex gap-3">
                      {/* 순번 + 라인 */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center font-semibold">
                          {i + 1}
                        </span>
                        {i < personaSteps.length - 1 && (
                          <span className="w-px flex-1 bg-gray-200 mt-1" />
                        )}
                      </div>
                      {/* 내용 */}
                      <div className="flex-1 pb-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-400">
                            {frameName(step.frameId)}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded border font-medium ${emo.cls}`}
                          >
                            {emo.emoji} {emo.label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 font-medium">{step.action}</p>
                        {step.verification && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERIFICATION_META[step.verification].cls}`}>
                              {VERIFICATION_META[step.verification].label}
                            </span>
                            {step.matchedEvidence && step.matchedEvidence.length > 0 && (
                              <span className="text-[11px] text-emerald-700">
                                {step.matchedEvidence.map((item) => `“${item}”`).join(', ')}
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-gray-500 italic leading-relaxed">
                          “{step.thought}”
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const FLOW_OUTCOME_META: Record<
  FlowOutcome,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  success: {
    label: '성공',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  partial: {
    label: '부분 성공',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: AlertCircle,
  },
  failed: {
    label: '실패',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircle,
  },
  abandoned: {
    label: '중단',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: AlertCircle,
  },
}

function FlowUTTab({ report }: { report: TestReport }) {
  const result = report.flowResult
  if (!result) return null

  const { config, metrics, runs, frictions } = result
  const orderedFrames = [...report.frames].sort(
    (a, b) => (a.flowOrder ?? Number.MAX_SAFE_INTEGER) - (b.flowOrder ?? Number.MAX_SAFE_INTEGER)
  )
  const visitCounts = new Map<string, number>()
  for (const run of runs) {
    visitCounts.set(config.entryFrameId, (visitCounts.get(config.entryFrameId) ?? 0) + 1)
    for (const event of run.events) {
      if (event.toFrameId) {
        visitCounts.set(event.toFrameId, (visitCounts.get(event.toFrameId) ?? 0) + 1)
      }
    }
  }

  const metricCards = [
    {
      label: '과업 성공률',
      value: `${metrics.successRate}%`,
      note: `${runs.filter((run) => run.outcome === 'success').length}/${runs.length}개 run 성공`,
      icon: Target,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: '첫 행동 정확도',
      value: `${metrics.firstActionAccuracy}%`,
      note: '기대 경로의 첫 행동 선택',
      icon: MousePointerClick,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: '평균 행동 단계',
      value: metrics.avgSteps.toFixed(1),
      note: '성공·실패 run 전체',
      icon: Gauge,
      color: 'text-indigo-600 bg-indigo-50',
    },
    {
      label: '평균 예상 시간',
      value: formatDuration(metrics.avgTaskDurationSeconds ?? 0),
      note: 'AI 망설임 기반 추정',
      icon: Clock,
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      label: '경로 효율',
      value: `${metrics.pathEfficiency}%`,
      note: `우회율 ${metrics.divergenceRate}%`,
      icon: Split,
      color: 'text-violet-600 bg-violet-50',
    },
    {
      label: '마찰 후 회복률',
      value: `${metrics.recoveryRate}%`,
      note: '마찰을 겪고도 성공한 비율',
      icon: RotateCcw,
      color: 'text-amber-600 bg-amber-50',
    },
  ]

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg bg-slate-950 text-white">
        <div className="grid gap-5 p-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-300">
              <Route className="h-4 w-4" />
              Flow mission
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-relaxed">{config.mission}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{config.scenario}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <p className="text-slate-400">진입점</p>
              <p className="mt-1 font-semibold text-white">
                {frameNameFromReport(report, config.entryFrameId)}
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <p className="text-slate-400">성공 지점</p>
              <p className="mt-1 font-semibold text-white">
                {frameNameFromReport(report, config.successFrameId)}
              </p>
            </div>
            <div className="col-span-2 rounded-md border border-white/10 bg-white/[0.04] p-3">
              <p className="text-slate-400">실행 범위</p>
              <p className="mt-1 font-semibold text-white">
                {report.personas.length}개 페르소나 · 최대 {config.maxSteps}단계
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map((metric) => {
          const Icon = metric.icon
          return (
            <div key={metric.label} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${metric.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-gray-950">{metric.value}</p>
              <p className="mt-1 text-xs font-semibold text-gray-700">{metric.label}</p>
              <p className="mt-1 text-[11px] text-gray-400">{metric.note}</p>
            </div>
          )
        })}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm leading-relaxed text-gray-700">{result.summary}</p>
        <p className="mt-2 text-[11px] font-medium text-gray-400">
          AI 시뮬레이션 결과 · 실제 사용자 조사 결과가 아닙니다
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Journey map</h3>
            <p className="mt-1 text-xs text-gray-500">
              기본 화면 순서와 실제 run의 방문 횟수를 함께 보여줍니다.
            </p>
          </div>
          <div className="overflow-x-auto p-4">
            <div className="flex min-w-max items-start gap-2">
              {orderedFrames.map((frame, index) => {
                const isEntry = frame.id === config.entryFrameId
                const isSuccess = frame.id === config.successFrameId
                const isDropoff = frame.id === metrics.dropoffFrameId
                return (
                  <div key={frame.id} className="flex items-center gap-2">
                    <div
                      className={`w-44 overflow-hidden rounded-md border ${
                        isEntry
                          ? 'border-blue-400'
                          : isSuccess
                          ? 'border-emerald-400'
                          : isDropoff
                          ? 'border-red-400'
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="aspect-[16/10] bg-gray-100">
                        {frame.imageUrl ? (
                          <img
                            src={frame.imageUrl}
                            alt=""
                            className="h-full w-full object-cover object-top"
                          />
                        ) : null}
                      </div>
                      <div className="p-2.5">
                        <div className="flex flex-wrap gap-1">
                          {isEntry && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              시작
                            </span>
                          )}
                          {isSuccess && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              성공
                            </span>
                          )}
                          {isDropoff && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              주요 이탈
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-gray-800">
                          {getFrameDisplayName(frame)}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {visitCounts.get(frame.id) ?? 0}회 방문
                        </p>
                      </div>
                    </div>
                    {index < orderedFrames.length - 1 && (
                      <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="border-t border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-700">
              숨겨진 화면 연결 · 테스트 종료 후 공개
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {config.edges.map((edge) => (
                <div
                  key={edge.id}
                  className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
                >
                  <span className="max-w-24 truncate font-medium">
                    {frameNameFromReport(report, edge.fromFrameId)}
                  </span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
                  <span className="max-w-24 truncate font-medium">
                    {frameNameFromReport(report, edge.toFrameId)}
                  </span>
                  <span className="ml-auto max-w-32 truncate text-gray-400">
                    {edge.actionLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              주요 마찰 ({frictions.length})
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              발생 빈도와 과업 실패 영향을 기준으로 정렬했습니다.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {frictions.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-gray-400">
                반복적으로 감지된 마찰이 없습니다.
              </p>
            ) : (
              frictions.map((friction) => (
                <div key={friction.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityBadgeClass[friction.severity]}`}
                    >
                      {severityLabel[friction.severity]}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {friction.affectedRunCount}개 run
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{friction.title}</p>
                  {friction.frameId && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      {frameNameFromReport(report, friction.frameId)}
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-gray-600">
                    {friction.recommendation}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Tester sessions</h3>
          <p className="mt-1 text-xs text-gray-500">
            각 페르소나가 어떤 행동을 선택했고 무엇을 기대했는지 확인합니다.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {runs.map((run) => {
            const outcome = FLOW_OUTCOME_META[run.outcome]
            const OutcomeIcon = outcome.icon
            const runDuration = run.events.reduce(
              (sum, event) => sum + (event.estimatedDurationSeconds ?? 0),
              0
            )
            return (
              <article key={run.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{run.personaName}</p>
                    <p className="mt-1 text-xs text-gray-500">{run.summary}</p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${outcome.className}`}
                    >
                      <OutcomeIcon className="h-3 w-3" />
                      {outcome.label}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Clock className="h-3 w-3" />
                      예상 {formatDuration(runDuration)}
                    </span>
                  </div>
                </div>
                <ol className="space-y-0 p-4">
                  {run.events.map((event, index) => (
                    <li key={event.id} className="grid grid-cols-[24px_1fr] gap-3">
                      <div className="flex flex-col items-center">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                          {event.step}
                        </span>
                        {index < run.events.length - 1 && (
                          <span className="mt-1 w-px flex-1 bg-gray-200" />
                        )}
                      </div>
                      <div className="pb-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                          <p>
                            {frameNameFromReport(report, event.fromFrameId)}
                            {event.toFrameId
                              ? ` → ${frameNameFromReport(report, event.toFrameId)}`
                              : ''}
                          </p>
                          <span>
                            예상 {formatDuration(event.estimatedDurationSeconds ?? 0)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-gray-800">
                          AI 선택 · {event.action}
                        </p>
                        {event.observedElement && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-blue-700">
                            <span>
                              실제 확인 요소 · {event.observedElement}
                              {event.confidence !== undefined ? ` · 검증 후 확신 ${event.confidence}%` : ''}
                            </span>
                            {event.verification && (
                              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERIFICATION_META[event.verification].cls}`}>
                                {VERIFICATION_META[event.verification].label}
                              </span>
                            )}
                          </div>
                        )}
                        {event.evidence && (
                          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                            화면 근거 · {event.evidence}
                          </p>
                        )}
                        {event.matchedEvidence && event.matchedEvidence.length > 0 && (
                          <p className="mt-1 text-[11px] text-emerald-700">
                            일치한 원문 · {event.matchedEvidence.map((item) => `“${item}”`).join(', ')}
                          </p>
                        )}
                        {event.expectedAction && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="text-gray-400">
                              내부 기준 · {event.expectedAction}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-semibold ${
                                event.transitionMatched
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              {event.transitionMatched ? '일치' : '불일치'}
                            </span>
                          </div>
                        )}
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">
                          기대: {event.expectation}
                        </p>
                        <div className="mt-2 rounded-md bg-gray-50 px-2.5 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Think Aloud
                          </p>
                          <p className="mt-1 text-xs italic leading-relaxed text-gray-600">
                            “{event.thought}”
                          </p>
                        </div>
                        {event.friction && (
                          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                            마찰 · {event.friction}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                {run.interview && run.interview.length > 0 && (
                  <div className="border-t border-gray-100 bg-blue-50/40 p-4">
                    <p className="text-xs font-semibold text-blue-950">사후 인터뷰</p>
                    <div className="mt-3 space-y-3">
                      {run.interview.map((item, index) => (
                        <div key={`${run.id}-interview-${index}`}>
                          <p className="text-[11px] font-semibold text-gray-700">
                            Q. {item.question}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600">
                            A. {item.answer}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/* ── 설계 의도 확인 (되묻기) ──────────────────────────────────
 * 주석을 미리 다 받지 않는다. 판정기가 "AI가 막힌 곳"을 짚어낸 지점에만
 * 디자이너에게 의도를 되묻고, 그 답을 다음 판정의 근거로 쓴다.
 */

const REASON_LABEL: Record<ClarificationRequest['reason'], string> = {
  blocked: '막힘',
  misread: '의미 오해',
}

const REASON_CLASS: Record<ClarificationRequest['reason'], string> = {
  blocked: 'bg-red-100 text-red-700',
  misread: 'bg-amber-100 text-amber-700',
}

const answerFieldClass =
  'w-full rounded-[10px] border border-white/10 bg-[#272729] px-3 py-2 text-sm text-gray-900'

function ClarificationCard({
  request,
  frameName,
  onAnswer,
}: {
  request: ClarificationRequest
  frameName: string
  onAnswer: (id: string, answer: DesignerAnswer) => void
}) {
  const [open, setOpen] = useState(false)
  const [elementName, setElementName] = useState(
    request.answer?.elementName ?? request.observedElement ?? ''
  )
  const [elementRole, setElementRole] = useState(request.answer?.elementRole ?? '')
  const [intendedAction, setIntendedAction] = useState(request.answer?.intendedAction ?? '')
  const [visibilityCondition, setVisibilityCondition] = useState(
    request.answer?.visibilityCondition ?? ''
  )
  const [notes, setNotes] = useState(request.answer?.notes ?? '')

  const answered = Boolean(request.answer)
  const canSave = elementName.trim().length > 0 && intendedAction.trim().length > 0

  const save = () => {
    if (!canSave) return
    onAnswer(request.id, {
      elementName: elementName.trim(),
      elementRole: elementRole.trim() || '미지정',
      intendedAction: intendedAction.trim(),
      visibilityCondition: visibilityCondition.trim() || undefined,
      notes: notes.trim() || undefined,
      answeredAt: new Date(),
    })
    setOpen(false)
  }

  return (
    <div className="rounded-[18px] border border-white/10 bg-[#1c1c1e] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${REASON_CLASS[request.reason]}`}
        >
          {REASON_LABEL[request.reason]}
        </span>
        <span className="text-xs text-gray-500">{frameName}</span>
        <span className="text-xs text-gray-400">
          · 페르소나 {request.affectedPersonas.length}명 ({request.affectedPersonas.join(', ')})
        </span>
        {answered && (
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            답변 완료
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-gray-900">{request.question}</p>

      {request.aiInterpretation && (
        <p className="mt-2 text-xs text-gray-500">AI가 이해한 내용: {request.aiInterpretation}</p>
      )}

      {answered && !open && (
        <div className="mt-3 space-y-1 rounded-[14px] bg-[#272729] p-4 text-xs text-gray-700">
          <p>
            <span className="text-gray-400">요소 </span>
            {request.answer?.elementName} · {request.answer?.elementRole}
          </p>
          <p>
            <span className="text-gray-400">의도한 행동 </span>
            {request.answer?.intendedAction}
          </p>
          {request.answer?.visibilityCondition && (
            <p>
              <span className="text-gray-400">표시 조건 </span>
              {request.answer.visibilityCondition}
            </p>
          )}
          {request.answer?.notes && (
            <p>
              <span className="text-gray-400">참고 </span>
              {request.answer.notes}
            </p>
          )}
        </div>
      )}

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">요소 이름 *</span>
              <input
                value={elementName}
                onChange={(event) => setElementName(event.target.value)}
                placeholder="예: 새 에이전트 생성 버튼"
                className={answerFieldClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">요소 역할</span>
              <input
                value={elementRole}
                onChange={(event) => setElementRole(event.target.value)}
                placeholder="예: 주요 CTA"
                className={answerFieldClass}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-gray-500">의도한 사용자 행동 *</span>
            <input
              value={intendedAction}
              onChange={(event) => setIntendedAction(event.target.value)}
              placeholder="예: 에이전트 생성 절차를 시작한다"
              className={answerFieldClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">표시·활성 조건</span>
              <input
                value={visibilityCondition}
                onChange={(event) => setVisibilityCondition(event.target.value)}
                placeholder="예: 로그인 완료 시에만 노출"
                className={answerFieldClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">참고사항</span>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="예: 프로토타입에서는 저장이 동작하지 않음"
                className={answerFieldClass}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={!canSave}>
              의도 저장
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              취소
            </Button>
            {!canSave && (
              <span className="text-xs text-gray-400">요소 이름과 의도한 행동은 필수입니다</span>
            )}
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          {answered ? '답변 수정' : '설계 의도 알려주기'}
        </Button>
      )}
    </div>
  )
}

function ClarificationTab({
  report,
  onClarificationsChange,
}: {
  report: TestReport
  onClarificationsChange: (clarifications: ClarificationRequest[]) => void
}) {
  const judgment = report.flowJudgment

  if (!judgment) {
    return (
      <p className="text-sm text-gray-500">
        이 리포트에는 판정 결과가 없습니다. Flow UT 모드로 테스트하면 설계 의도 대조가 실행됩니다.
      </p>
    )
  }

  const clarifications = judgment.clarifications
  const answeredCount = clarifications.filter((item) => item.answer).length

  const handleAnswer = (id: string, answer: DesignerAnswer) => {
    onClarificationsChange(
      clarifications.map((item) => (item.id === id ? { ...item, answer } : item))
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[18px] border border-white/10 bg-[#1c1c1e] p-6">
        <h3 className="text-[17px] font-semibold text-gray-900">AI가 이해하지 못한 지점</h3>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-gray-500">
          AI 페르소나는 설계 의도를 보지 않고 행동했습니다. 아래는 판정기가 실제 행동과 정의된 흐름을
          대조해 찾아낸, AI가 스스로 해석하지 못한 지점입니다. 여기에만 의도를 알려주면 다음 테스트의
          판정이 정확해집니다.
        </p>
        <div className="mt-5 flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-gray-400">막힌 단계</p>
            <p className="text-2xl font-bold text-red-600">{judgment.blockedStepCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">의미를 오해한 단계</p>
            <p className="text-2xl font-bold text-amber-700">{judgment.misreadStepCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">첫 행동이 의도와 일치</p>
            <p className="text-2xl font-bold text-blue-600">{judgment.intendedFirstActionRate}%</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">답변한 질문</p>
            <p className="text-2xl font-bold text-gray-900">
              {answeredCount}/{clarifications.length}
            </p>
          </div>
        </div>
      </div>

      {clarifications.length === 0 ? (
        <div className="rounded-[18px] border border-white/10 bg-[#1c1c1e] p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="text-sm font-medium text-gray-900">되물을 것이 없습니다</p>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            모든 행동이 정의된 흐름 안에서 해석됐습니다. 화면만 보고도 다음 행동을 찾을 수 있었다는
            뜻입니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clarifications.map((request) => (
            <ClarificationCard
              key={request.id}
              request={request}
              frameName={frameNameFromReport(report, request.frameId)}
              onAnswer={handleAnswer}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── 탭 타입 ── */
type ReportTab =
  | 'flow'
  | 'summary'
  | 'findings'
  | 'walkthrough'
  | 'clarify'
  | 'chat'

function downloadJson(report: TestReport) {
  const {
    id,
    projectName,
    createdAt,
    personas,
    flowConfig,
    flowResult,
    flowJudgment,
    axisScores,
    findings,
    taskMetrics,
    overallSummary,
    walkthrough,
    validation,
    feedbackThreads,
  } =
    report
  const payload = {
    id,
    projectName,
    createdAt,
    personas: personas.map(({ id, name, role, digitalLevel, goal, device, context }) => ({
      id,
      name,
      role,
      digitalLevel,
      goal,
      device,
      context,
    })),
    flowConfig,
    flowResult,
    flowJudgment,
    axisScores,
    findings,
    taskMetrics,
    overallSummary,
    walkthrough,
    validation,
    feedbackThreads,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `personaflow-report-${id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* ── 메인 컴포넌트 ── */
export default function ReportPage({
  report,
  onNewTest,
  apiKey,
  model,
  onRequireKey,
  onFeedbackThreadsChange,
  onClarificationsChange,
}: ReportPageProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>(
    report.flowResult ? 'flow' : 'summary'
  )

  const findingsCount = report.findings.length
  const walkCount = report.walkthrough?.length ?? 0
  const clarifications = report.flowJudgment?.clarifications ?? []
  const openClarifications = clarifications.filter((item) => !item.answer).length

  const formattedDate = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(report.createdAt)

  const tabs: { key: ReportTab; label: string }[] = [
    ...(report.flowResult ? [{ key: 'flow' as const, label: 'Flow UT' }] : []),
    { key: 'summary', label: '요약' },
    { key: 'findings', label: `발견된 문제 (${findingsCount})` },
    { key: 'walkthrough', label: `클릭 시뮬레이션 (${walkCount})` },
    ...(report.flowJudgment
      ? [
          {
            key: 'clarify' as const,
            label:
              openClarifications > 0
                ? `설계 의도 확인 (${openClarifications})`
                : '설계 의도 확인',
          },
        ]
      : []),
    { key: 'chat', label: '인라인 채팅' },
  ]

  return (
    <div className="report-page flex h-full flex-col bg-[#0b0b0c]">
      {/* 리포트 상단 */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-white/10 bg-[#111113] px-10 py-7">
        <div>
          <p className="text-sm font-medium text-blue-500">UX 테스트 리포트</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.025em] text-white">{report.projectName}</h1>
          <p className="mt-1 text-xs text-gray-500">{formattedDate} 생성</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadJson(report)}
            className="gap-1.5 text-xs"
          >
            <FileJson className="w-3.5 h-3.5" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="gap-1.5 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
          <Button onClick={onNewTest} className="gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            새 테스트
          </Button>
        </div>
      </div>

      {/* 언더라인 탭 */}
      <div className="border-b border-white/10 bg-[#111113] px-10 pb-4">
        <div className="inline-flex gap-1 rounded-full bg-[#1c1c1e] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#48484a] text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="flex-1 overflow-auto px-10 py-8">
        <div className="mx-auto max-w-[1180px]">
        {activeTab === 'flow' && <FlowUTTab report={report} />}
        {activeTab === 'summary' && <SummaryTab report={report} />}
        {activeTab === 'findings' && <FindingsTab report={report} />}
        {activeTab === 'walkthrough' && <WalkthroughTab report={report} />}
        {activeTab === 'clarify' && (
          <ClarificationTab
            report={report}
            onClarificationsChange={onClarificationsChange}
          />
        )}
        {activeTab === 'chat' && (
          <InlineChatTab
            report={report}
            apiKey={apiKey}
            model={model}
            onRequireKey={onRequireKey}
            onFeedbackThreadsChange={onFeedbackThreadsChange}
          />
        )}
        </div>
      </div>
    </div>
  )
}
