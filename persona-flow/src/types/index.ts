export type SeverityLevel = 'critical' | 'warning' | 'suggestion'
export type DigitalLevel = 'beginner' | 'intermediate' | 'expert'
export type DeviceType = 'desktop' | 'mobile' | 'tablet'
export type SourceType = 'figma' | 'image'
export type AIMode = 'demo' | 'gemini_free'
export type StudyMode = 'flow' | 'screen'
export type EvidenceVerification = 'verified' | 'partial' | 'unverified'
export type MetricProvenance = 'ai_estimate' | 'simulation_aggregate' | 'observed'

export interface FigmaSource {
  url: string
  fileKey: string
  nodeId?: string
  versionId?: string
  fileName?: string
  selectionLabel?: string
  connectedAt: Date
}

export interface PrototypeTransition {
  trigger: string
  action: string
  sourceNodeName: string
  destinationNodeId?: string
}

export interface FrameDesignContext {
  source: 'figma_api' | 'image_only'
  visibleTexts: string[]
  componentLabels: string[]
  interactiveLabels: string[]
  structureLabels: string[]
  prototypeTransitions: PrototypeTransition[]
  dimensions?: {
    width: number
    height: number
  }
}

export interface Frame {
  id: string
  name: string
  imageUrl: string
  originalName?: string
  userLabel?: string
  flowOrder?: number
  file?: File
  sourceType?: SourceType
  figmaFileKey?: string
  figmaNodeId?: string
  figmaVersionId?: string
  figmaUrl?: string
  designContext?: FrameDesignContext
}

export interface FlowEdge {
  id: string
  fromFrameId: string
  toFrameId: string
  actionLabel: string
}

export interface FlowTestConfig {
  mode: StudyMode
  title: string
  scenario: string
  mission: string
  entryFrameId: string
  successFrameId: string
  expectedPathFrameIds: string[]
  edges: FlowEdge[]
  maxSteps: number
}

export interface PersonaConfig {
  id: string
  name: string
  role: string
  digitalLevel: DigitalLevel
  goal: string
  device: DeviceType
  context: string
  isAiGenerated?: boolean
  avatar?: string
}

export interface AxisScore {
  axis: number
  label: string
  score: number
  icon: string
}

export interface Finding {
  id: string
  severity: SeverityLevel
  axis: number
  axisLabel: string
  heuristic: string
  problem: string
  taskMetric: string
  suggestion: string
  frameId?: string
  evidence?: string
  confidence?: number
  verification?: EvidenceVerification
  matchedEvidence?: string[]
}

export interface TaskMetrics {
  completionRate: number
  avgClicks: number
  errorRate: number
  dropoffPoint: string
  provenance?: MetricProvenance
  disclaimer?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'persona'
  content: string
  timestamp: Date
}

export interface FrameChat {
  frameId: string
  messages: ChatMessage[]
}

export interface FeedbackThread {
  id: string
  frameId: string
  personaId: string
  messages: ChatMessage[]
  updatedAt: Date
}

export type WalkEmotion = 'positive' | 'neutral' | 'confused' | 'frustrated'

export interface WalkStep {
  frameId: string
  personaName: string
  action: string
  thought: string
  emotion: WalkEmotion
  observedElement?: string
  evidence?: string
  confidence?: number
  verification?: EvidenceVerification
  matchedEvidence?: string[]
}

export interface AnalysisValidation {
  score: number
  status: 'high' | 'medium' | 'low'
  verifiedFindings: number
  totalFindings: number
  verifiedWalkthroughSteps: number
  totalWalkthroughSteps: number
  invalidFrameReferences: number
  inputCoverage: {
    totalFrames: number
    imageFrames: number
    metadataFrames: number
  }
  warnings: string[]
}

export type FlowOutcome = 'success' | 'partial' | 'failed' | 'abandoned'

export interface FlowInterview {
  question: string
  answer: string
}

export interface FlowEvent {
  id: string
  step: number
  fromFrameId: string
  toFrameId?: string
  action: string
  expectation: string
  thought: string
  emotion: WalkEmotion
  estimatedDurationSeconds?: number
  expectedAction?: string
  transitionMatched?: boolean
  /** AI가 이 행동 후 나타나리라 스스로 예측한 화면 (판정에서 기대 불일치 탐지에 사용) */
  aiExpectedFrameId?: string
  observedElement?: string
  evidence?: string
  confidence?: number
  verification?: EvidenceVerification
  matchedEvidence?: string[]
  friction?: string
  recommendation?: string
}

export interface FlowRun {
  id: string
  personaId: string
  personaName: string
  outcome: FlowOutcome
  events: FlowEvent[]
  interview?: FlowInterview[]
  summary: string
}

export interface FlowMetrics {
  successRate: number
  firstActionAccuracy: number
  avgSteps: number
  avgTaskDurationSeconds: number
  pathEfficiency: number
  divergenceRate: number
  recoveryRate: number
  dropoffFrameId?: string
}

export interface FlowFriction {
  id: string
  title: string
  description: string
  severity: SeverityLevel
  frameId?: string
  affectedRunCount: number
  recommendation: string
}

export interface FlowTestResult {
  config: FlowTestConfig
  runs: FlowRun[]
  metrics: FlowMetrics
  frictions: FlowFriction[]
  summary: string
}

/* ── 사후 판정 ──────────────────────────────────────────────
 * AI 페르소나는 설계 의도를 보지 못한 채 행동한다.
 * 아래 타입들은 행동이 끝난 뒤 디자이너의 의도와 비교한 결과를 담는다.
 * 판정은 LLM이 아니라 코드가 수행한다(모델을 바꿔도 판정이 흔들리지 않도록).
 */

export type StepVerdict =
  /** 디자이너가 정의한 기대 경로 위의 연결을 선택함 */
  | 'intended'
  /** 정의된 연결이지만 기대 경로는 아님 (대안 경로) */
  | 'alternate_path'
  /** 요소는 찾았으나 그 결과를 잘못 예측함 */
  | 'misread'
  /** 어떤 정의된 연결과도 맞지 않음 — AI가 막힌 지점 */
  | 'blocked'

export interface StepJudgment {
  runId: string
  personaId: string
  personaName: string
  step: number
  frameId: string
  verdict: StepVerdict
  /** AI가 실제로 붙든 화면 요소 */
  observedElement?: string
  /** AI가 그 행동 후 나타나리라 예상한 화면 */
  aiExpectedFrameId?: string
  /** 디자이너가 이 화면에서 정의해 둔 행동 */
  intendedAction?: string
  intendedTargetFrameId?: string
  /** 실제로 이동한 화면 (판정 후 확정) */
  actualTargetFrameId?: string
  onExpectedPath: boolean
}

/** 디자이너가 되묻기에 답한 내용 — 기획안 1.1의 요소 주석과 같은 구조 */
export interface DesignerAnswer {
  elementName: string
  elementRole: string
  intendedAction: string
  destinationFrameId?: string
  visibilityCondition?: string
  notes?: string
  answeredAt: Date
}

/**
 * AI가 이해하지 못한 지점에 대해 디자이너에게 던지는 질문.
 * 주석을 미리 다 받지 않고, 판정기가 막힌 곳만 골라 되묻는다.
 */
export interface ClarificationRequest {
  id: string
  frameId: string
  /** AI가 붙들었던 화면 요소 (없으면 아무 요소도 찾지 못한 경우) */
  observedElement?: string
  /** AI가 그 요소를 무엇이라고 이해했는지 */
  aiInterpretation?: string
  reason: 'blocked' | 'misread'
  /** 같은 지점에서 막힌 페르소나 이름들 */
  affectedPersonas: string[]
  /** 화면에 노출할 질문 문장 */
  question: string
  answer?: DesignerAnswer
}

/* ── 화면 관찰 결과 ─────────────────────────────────────────
 * 관찰기 단계의 산출물. UX 평가가 아니라 화면에서 확인된 사실만 담는다.
 */

export interface ObservedElement {
  label: string
  role: string
  location: string
  confidence: number
}

export interface ScreenObservation {
  frameId: string
  summary: string
  visibleTexts: string[]
  interactiveElements: ObservedElement[]
  unreadableAreas: string[]
}

/* ── 분석 실행 컨텍스트 ─────────────────────────────────────
 * 분석 한 번은 여러 번의 순차 호출로 이루어진다.
 * 중간에 실패하거나 사용자가 화면을 벗어났을 때 앞의 작업을 버리지 않기 위한 장치.
 */

export type AnalysisStage = 'observe' | 'test' | 'judge' | 'analyze'

export interface AnalysisRetryNotice {
  attempt: number
  maxAttempts: number
  waitMs: number
  reason: string
}

export interface AnalysisProgress {
  stage: AnalysisStage
  /** 단계 내 진행 단위 (예: 판독한 화면 배치 수) */
  completed: number
  /** 0이면 진행 단위를 알 수 없는 단계 */
  total: number
  /** 재시도 대기 중일 때만 채워진다 */
  retry?: AnalysisRetryNotice
}

/**
 * 단계별 중간 산출물.
 * 호출자가 소유하며, 재시도 시 같은 객체를 그대로 넘기면
 * 이미 끝난 단계는 다시 호출하지 않는다.
 */
export interface AnalysisCheckpoint {
  observations?: ScreenObservation[]
  flowRuns?: FlowRun[]
}

export interface AnalysisRunContext {
  signal?: AbortSignal
  onProgress?: (progress: AnalysisProgress) => void
  checkpoint?: AnalysisCheckpoint
}

export interface FlowJudgment {
  steps: StepJudgment[]
  clarifications: ClarificationRequest[]
  /** 첫 행동이 기대 경로와 일치한 run 비율 (0~100) */
  intendedFirstActionRate: number
  blockedStepCount: number
  misreadStepCount: number
  judgedStepCount: number
}

export interface TestReport {
  id: string
  projectName: string
  createdAt: Date
  sourceType?: SourceType
  figmaSource?: FigmaSource
  aiMode?: AIMode
  personas: PersonaConfig[]
  frames: Frame[]
  flowConfig?: FlowTestConfig
  flowResult?: FlowTestResult
  /** 설계 의도와 실제 행동을 비교한 사후 판정 결과 */
  flowJudgment?: FlowJudgment
  axisScores: AxisScore[]
  findings: Finding[]
  taskMetrics: TaskMetrics
  overallSummary: string
  frameChats: FrameChat[]
  feedbackThreads?: FeedbackThread[]
  walkthrough?: WalkStep[]
  validation?: AnalysisValidation
}

export type AppStep = 'upload' | 'flow' | 'persona' | 'running' | 'report'
