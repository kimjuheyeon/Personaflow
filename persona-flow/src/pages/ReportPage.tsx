import { useState } from 'react'
import {
  Send,
  Download,
  FileJson,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  GitCompare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { chatWithPersona } from '@/lib/ai/gemini'
import { getFrameDisplayName } from '@/lib/frameNaming'
import type {
  TestReport,
  Finding,
  SeverityLevel,
  WalkEmotion,
  ChatMessage,
  FeedbackThread,
  Frame,
} from '@/types'

interface ReportPageProps {
  report: TestReport
  onNewTest: () => void
  apiKey: string
  model: string
  onRequireKey: () => void
  onFeedbackThreadsChange: (threads: FeedbackThread[]) => void
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

function findReportFrame(
  report: TestReport,
  frameId: string
): { frame: Frame; variantName?: string } | undefined {
  for (const variant of report.variants ?? []) {
    const frame = variant.frames.find((item) => item.id === frameId)
    if (frame) return { frame, variantName: `${variant.id}안` }
  }

  const frame = report.frames.find((item) => item.id === frameId)
  return frame ? { frame } : undefined
}

function frameNameFromReport(report: TestReport, frameId: string): string {
  const context = findReportFrame(report, frameId)
  if (!context) return frameId
  const name = getFrameDisplayName(context.frame)
  return context.variantName ? `${context.variantName} ${name}` : name
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

/* ── 탭1 요약 ── */
function SummaryTab({ report }: { report: TestReport }) {
  const criticalCount = report.findings.filter((f) => f.severity === 'critical').length
  const warningCount = report.findings.filter((f) => f.severity === 'warning').length
  const suggestionCount = report.findings.filter((f) => f.severity === 'suggestion').length

  return (
    <div className="space-y-5">
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
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">태스크 지표</h3>
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

function ABComparisonTab({ report }: { report: TestReport }) {
  const comparison = report.abComparison

  if (!comparison) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-sm">A/B 비교 데이터가 없습니다.</p>
      </div>
    )
  }

  const winnerLabel =
    comparison.winner === 'tie' ? '상황별 우세' : `${comparison.winner}안 우세`

  return (
    <div className="space-y-5">
      <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              A/B 테스트 결과
            </h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-900 text-white">
            {winnerLabel}
          </span>
        </div>
        <div className="p-4 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">종합 판단</p>
              <p className="text-sm text-gray-800 leading-relaxed">{comparison.summary}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">적용 권고</p>
              <p className="text-sm text-gray-700 bg-green-50 border border-green-200 rounded px-3 py-2 leading-relaxed">
                {comparison.recommendation}
              </p>
            </div>
          </div>
          <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 mb-2">확신도</p>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold text-blue-600">{comparison.confidence}</span>
              <span className="text-xs text-gray-500 pb-1">/ 100</span>
            </div>
            <Progress value={comparison.confidence} className="h-2" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {comparison.variantScores.map((variant) => (
          <div
            key={variant.variantId}
            className="border border-gray-200 rounded-md bg-white overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{variant.variantId}안</h3>
              <span className="text-xs text-gray-500">
                완료율 {variant.taskMetrics.completionRate}% · 오류율 {variant.taskMetrics.errorRate}%
              </span>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                {variant.axisScores.map((axis) => (
                  <div key={axis.axis} className="grid grid-cols-[1fr_2fr_2rem] gap-3 items-center">
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold text-green-700 mb-1">강점</p>
                  <ul className="space-y-1">
                    {variant.strengths.map((item) => (
                      <li key={item} className="text-xs text-gray-600 leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-700 mb-1">약점</p>
                  <ul className="space-y-1">
                    {variant.weaknesses.map((item) => (
                      <li key={item} className="text-xs text-gray-600 leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              핵심 인사이트
            </h3>
          </div>
          <div className="p-4 space-y-2">
            {comparison.keyInsights.map((insight) => (
              <p key={insight} className="text-sm text-gray-700 leading-relaxed">
                {insight}
              </p>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              페르소나별 선호
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {comparison.personaPreferences.map((preference) => (
              <div key={`${preference.personaName}-${preference.preferredVariant}`} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">
                    {preference.personaName}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                    {preference.preferredVariant === 'tie'
                      ? '상황별'
                      : `${preference.preferredVariant}안`}
                  </span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{preference.reason}</p>
              </div>
            ))}
          </div>
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

    const frameContext = findReportFrame(report, selectedFrameId)
    const fallbackFrame = frames.find((frame) => frame.id === selectedFrameId)
    const frame = frameContext?.frame ?? fallbackFrame ?? null
    const frameDisplayName = frameContext
      ? frameNameFromReport(report, selectedFrameId)
      : frame
        ? getFrameDisplayName(frame)
        : ''
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
                  {findReportFrame(report, frame.id)
                    ? frameNameFromReport(report, frame.id)
                    : getFrameDisplayName(frame)}
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

/* ── 탭 타입 ── */
type ReportTab = 'summary' | 'ab' | 'findings' | 'walkthrough' | 'chat'

function downloadJson(report: TestReport) {
  const {
    id,
    projectName,
    createdAt,
    testMode,
    personas,
    variants,
    abConfig,
    abComparison,
    axisScores,
    findings,
    taskMetrics,
    overallSummary,
    walkthrough,
    feedbackThreads,
  } =
    report
  const payload = {
    id,
    projectName,
    createdAt,
    testMode,
    personas: personas.map(({ id, name, role, digitalLevel, goal, device, context }) => ({
      id,
      name,
      role,
      digitalLevel,
      goal,
      device,
      context,
    })),
    variants,
    abConfig,
    abComparison,
    axisScores,
    findings,
    taskMetrics,
    overallSummary,
    walkthrough,
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
}: ReportPageProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>('summary')

  const findingsCount = report.findings.length
  const walkCount = report.walkthrough?.length ?? 0

  const formattedDate = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(report.createdAt)

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'summary', label: '요약' },
    ...(report.abComparison ? [{ key: 'ab' as const, label: 'A/B 비교' }] : []),
    { key: 'findings', label: `발견된 문제 (${findingsCount})` },
    { key: 'walkthrough', label: `클릭 시뮬레이션 (${walkCount})` },
    { key: 'chat', label: '인라인 채팅' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 리포트 상단 */}
      <div className="px-8 py-4 bg-white border-b border-gray-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{report.projectName}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{formattedDate} 생성</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadJson(report)}
            className="gap-1.5 text-xs h-8"
          >
            <FileJson className="w-3.5 h-3.5" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="gap-1.5 text-xs h-8"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
          <Button size="sm" onClick={onNewTest} className="gap-1.5 text-xs h-8">
            <RefreshCw className="w-3.5 h-3.5" />
            새 테스트
          </Button>
        </div>
      </div>

      {/* 언더라인 탭 */}
      <div className="px-8 bg-white border-b border-gray-200">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {activeTab === 'summary' && <SummaryTab report={report} />}
        {activeTab === 'ab' && <ABComparisonTab report={report} />}
        {activeTab === 'findings' && <FindingsTab report={report} />}
        {activeTab === 'walkthrough' && <WalkthroughTab report={report} />}
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
  )
}
