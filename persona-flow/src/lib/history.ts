import type {
  ChatMessage,
  FeedbackThread,
  FigmaSource,
  FlowJudgment,
  Frame,
  FrameChat,
  TestReport,
} from '@/types'

const HISTORY_STORAGE = 'personaflow_test_history'
const MAX_HISTORY = 20

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    timestamp: toDate(message.timestamp),
  }
}

function normalizeFrame(frame: Frame): Frame {
  return {
    id: frame.id,
    name: frame.name,
    imageUrl: frame.imageUrl,
    originalName: frame.originalName,
    userLabel: frame.userLabel,
    flowOrder: frame.flowOrder,
    sourceType: frame.sourceType,
    figmaFileKey: frame.figmaFileKey,
    figmaNodeId: frame.figmaNodeId,
    figmaVersionId: frame.figmaVersionId,
    figmaUrl: frame.figmaUrl,
    designContext: frame.designContext,
  }
}

function normalizeFigmaSource(source: FigmaSource | undefined): FigmaSource | undefined {
  if (!source) return undefined
  return {
    ...source,
    connectedAt: toDate(source.connectedAt),
  }
}

function normalizeFrameChat(frameChat: FrameChat): FrameChat {
  return {
    frameId: frameChat.frameId,
    messages: (frameChat.messages ?? []).map(normalizeMessage),
  }
}

function normalizeFeedbackThread(thread: FeedbackThread): FeedbackThread {
  return {
    id: thread.id,
    frameId: thread.frameId,
    personaId: thread.personaId,
    messages: (thread.messages ?? []).map(normalizeMessage),
    updatedAt: toDate(thread.updatedAt),
  }
}

function normalizeFlowJudgment(
  judgment: FlowJudgment | undefined
): FlowJudgment | undefined {
  if (!judgment) return undefined
  return {
    ...judgment,
    steps: judgment.steps ?? [],
    clarifications: (judgment.clarifications ?? []).map((request) => ({
      ...request,
      affectedPersonas: request.affectedPersonas ?? [],
      answer: request.answer
        ? { ...request.answer, answeredAt: toDate(request.answer.answeredAt) }
        : undefined,
    })),
  }
}

/** A/B 비교 기능이 제거되기 전에 저장된 리포트는 더 이상 열 수 없으므로 목록에서 뺀다. */
function isLegacyABReport(report: TestReport): boolean {
  return (report as { testMode?: string }).testMode === 'ab'
}

function normalizeReport(report: TestReport): TestReport {
  return {
    ...report,
    createdAt: toDate(report.createdAt),
    flowJudgment: normalizeFlowJudgment(report.flowJudgment),
    figmaSource: normalizeFigmaSource(report.figmaSource),
    frames: (report.frames ?? []).map(normalizeFrame),
    frameChats: (report.frameChats ?? []).map(normalizeFrameChat),
    feedbackThreads: (report.feedbackThreads ?? []).map(normalizeFeedbackThread),
  }
}

function removeHeavyFrameImages(report: TestReport): TestReport {
  return {
    ...report,
    frames: report.frames.map((frame) => ({
      ...frame,
      imageUrl: frame.imageUrl.startsWith('data:') ? '' : frame.imageUrl,
    })),
  }
}

function writeHistory(reports: TestReport[]): TestReport[] {
  const normalized = reports.map(normalizeReport).slice(0, MAX_HISTORY)
  const attempts = [
    normalized,
    normalized.map(removeHeavyFrameImages),
    normalized.slice(0, 5).map(removeHeavyFrameImages),
  ]

  for (const attempt of attempts) {
    try {
      localStorage.setItem(HISTORY_STORAGE, JSON.stringify(attempt))
      return attempt
    } catch {
      /* try a smaller payload */
    }
  }

  return normalized
}

export function getTestHistory(): TestReport[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TestReport[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((report) => !isLegacyABReport(report)).map(normalizeReport)
  } catch {
    return []
  }
}

export function saveTestReport(report: TestReport): TestReport[] {
  const normalized = normalizeReport(report)
  const current = getTestHistory()
  const next = [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, MAX_HISTORY)

  return writeHistory(next)
}

export function updateTestReportFeedback(
  reportId: string,
  feedbackThreads: FeedbackThread[]
): { reports: TestReport[]; found: boolean } {
  const current = getTestHistory()
  let found = false
  const next = current.map((report) => {
    if (report.id !== reportId) return report
    found = true
    return normalizeReport({
      ...report,
      feedbackThreads,
    })
  })

  if (!found) return { reports: current, found: false }

  return {
    reports: writeHistory(next),
    found: true,
  }
}
