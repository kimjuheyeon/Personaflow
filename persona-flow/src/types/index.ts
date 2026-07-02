export type SeverityLevel = 'critical' | 'warning' | 'suggestion'
export type DigitalLevel = 'beginner' | 'intermediate' | 'expert'
export type DeviceType = 'desktop' | 'mobile' | 'tablet'
export type TestMode = 'single' | 'ab'
export type VariantId = 'A' | 'B'

export interface Frame {
  id: string
  name: string
  imageUrl: string
  originalName?: string
  userLabel?: string
  flowOrder?: number
  file?: File
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
}

export interface TaskMetrics {
  completionRate: number
  avgClicks: number
  errorRate: number
  dropoffPoint: string
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
}

export interface TestReport {
  id: string
  projectName: string
  createdAt: Date
  testMode?: TestMode
  personas: PersonaConfig[]
  frames: Frame[]
  variants?: DesignVariant[]
  abConfig?: ABTestConfig
  abComparison?: ABComparison
  axisScores: AxisScore[]
  findings: Finding[]
  taskMetrics: TaskMetrics
  overallSummary: string
  frameChats: FrameChat[]
  feedbackThreads?: FeedbackThread[]
  walkthrough?: WalkStep[]
}

export type AppStep = 'upload' | 'persona' | 'running' | 'report'
