export type SeverityLevel = 'critical' | 'warning' | 'suggestion'
export type DigitalLevel = 'beginner' | 'intermediate' | 'expert'
export type DeviceType = 'desktop' | 'mobile' | 'tablet'

export interface Frame {
  id: string
  name: string
  imageUrl: string
  file?: File
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

export interface TestReport {
  id: string
  projectName: string
  createdAt: Date
  personas: PersonaConfig[]
  frames: Frame[]
  axisScores: AxisScore[]
  findings: Finding[]
  taskMetrics: TaskMetrics
  overallSummary: string
  frameChats: FrameChat[]
}

export type AppStep = 'upload' | 'persona' | 'running' | 'report'
