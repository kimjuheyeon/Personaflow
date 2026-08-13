export type SeverityLevel = 'critical' | 'warning' | 'suggestion'
export type DigitalLevel = 'beginner' | 'intermediate' | 'expert'
export type DeviceType = 'desktop' | 'mobile' | 'tablet'
export type TestMode = 'single' | 'ab'
export type VariantId = 'A' | 'B'
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

export interface DesignVariant {
  id: VariantId
  name: string
  frames: Frame[]
}

export interface ABTestConfig {
  goal: string
  hypothesis: string
  criteria: string[]
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

export interface ABVariantScore {
  variantId: VariantId
  axisScores: AxisScore[]
  taskMetrics: TaskMetrics
  strengths: string[]
  weaknesses: string[]
}

export interface PersonaPreference {
  personaId?: string
  personaName: string
  preferredVariant: VariantId | 'tie'
  reason: string
}

export interface ABComparison {
  winner: VariantId | 'tie'
  confidence: number
  summary: string
  recommendation: string
  keyInsights: string[]
  variantScores: ABVariantScore[]
  personaPreferences: PersonaPreference[]
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

export interface TestReport {
  id: string
  projectName: string
  createdAt: Date
  sourceType?: SourceType
  figmaSource?: FigmaSource
  aiMode?: AIMode
  testMode?: TestMode
  personas: PersonaConfig[]
  frames: Frame[]
  variants?: DesignVariant[]
  abConfig?: ABTestConfig
  abComparison?: ABComparison
  flowConfig?: FlowTestConfig
  flowResult?: FlowTestResult
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
