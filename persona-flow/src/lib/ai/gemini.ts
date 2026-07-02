/**
 * Google Gemini API 클라이언트 (브라우저 직접 호출 / BYOK).
 * 무료 티어: https://aistudio.google.com/apikey 에서 키 발급.
 */

import type {
  ABComparison,
  ABTestConfig,
  DesignVariant,
  PersonaConfig,
  AxisScore,
  Finding,
  TaskMetrics,
  WalkStep,
  ChatMessage,
  VariantId,
} from '@/types'
import { imageToBase64 } from '@/lib/image'
import {
  AXES,
  personaSuggestionPrompt,
  analysisPrompt,
  abAnalysisPrompt,
  chatSystemPrompt,
} from './prompts'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

interface GenerateOptions {
  apiKey: string
  model: string
  systemInstruction?: string
  contents: Content[]
  responseSchema?: unknown
  temperature?: number
}

async function generateContent(opts: GenerateOptions): Promise<string> {
  const url = `${API_BASE}/${opts.model}:generateContent?key=${encodeURIComponent(
    opts.apiKey
  )}`

  const body: Record<string, unknown> = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.responseSchema
        ? {
            responseMimeType: 'application/json',
            responseSchema: opts.responseSchema,
          }
        : {}),
    },
  }
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('네트워크 오류로 Gemini에 연결할 수 없습니다.')
  }

  if (!res.ok) {
    let msg = `Gemini 요청 실패 (HTTP ${res.status})`
    try {
      const err = await res.json()
      const detail = err?.error?.message
      if (detail) msg = detail
    } catch {
      /* ignore */
    }
    if (res.status === 400) msg = `API 키가 올바르지 않거나 요청이 거부되었습니다. (${msg})`
    if (res.status === 429) msg = `무료 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요. (${msg})`
    throw new Error(msg)
  }

  const data = await res.json()
  const blockReason = data?.promptFeedback?.blockReason
  if (blockReason) {
    throw new Error(`요청이 안전 필터에 의해 차단되었습니다. (${blockReason})`)
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('Gemini가 빈 응답을 반환했습니다. 다시 시도해주세요.')
  return text
}

function parseJson<T>(text: string): T {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  }
  try {
    return JSON.parse(t) as T
  } catch {
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해주세요.')
  }
}

type FrameInput = { id: string; name: string; file?: File; imageUrl: string }

async function buildFrameParts(frames: FrameInput[]): Promise<Part[]> {
  const parts: Part[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const img = await imageToBase64(f.file ?? f.imageUrl)
    parts.push({ text: `■ 화면 #${i + 1} | ID: ${f.id} | 이름: ${f.name}` })
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
  }
  return parts
}

async function buildVariantParts(variants: DesignVariant[]): Promise<Part[]> {
  const parts: Part[] = []
  for (const variant of variants) {
    parts.push({ text: `■ ${variant.name} (${variant.id}안)` })
    for (let i = 0; i < variant.frames.length; i++) {
      const frame = variant.frames[i]
      const img = await imageToBase64(frame.file ?? frame.imageUrl)
      parts.push({
        text: `■ ${variant.id}안 화면 #${i + 1} | ID: ${frame.id} | 이름: ${frame.name}`,
      })
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
    }
  }
  return parts
}

/* ── 0) 키 검증 ── */

export async function testApiKey(apiKey: string, model: string): Promise<void> {
  await generateContent({
    apiKey,
    model,
    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    temperature: 0,
  })
}

/* ── 1) 페르소나 추천 ── */

interface RawPersona {
  name: string
  role: string
  digitalLevel: PersonaConfig['digitalLevel']
  goal: string
  device: PersonaConfig['device']
  context: string
  avatar?: string
}

const personaSchema = {
  type: 'OBJECT',
  properties: {
    personas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          role: { type: 'STRING' },
          digitalLevel: {
            type: 'STRING',
            enum: ['beginner', 'intermediate', 'expert'],
          },
          goal: { type: 'STRING' },
          device: { type: 'STRING', enum: ['desktop', 'mobile', 'tablet'] },
          context: { type: 'STRING' },
          avatar: { type: 'STRING' },
        },
        required: ['name', 'role', 'digitalLevel', 'goal', 'device', 'context'],
      },
    },
  },
  required: ['personas'],
}

export async function suggestPersonas(
  apiKey: string,
  model: string,
  frames: FrameInput[]
): Promise<PersonaConfig[]> {
  const frameParts = await buildFrameParts(frames)
  const text = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [...frameParts, { text: personaSuggestionPrompt(frames.length) }],
      },
    ],
    responseSchema: personaSchema,
    temperature: 0.9,
  })

  const parsed = parseJson<{ personas: RawPersona[] }>(text)
  return (parsed.personas ?? []).map((p, i) => ({
    id: `ai-${Date.now()}-${i}`,
    name: p.name,
    role: p.role,
    digitalLevel: p.digitalLevel,
    goal: p.goal,
    device: p.device,
    context: p.context,
    avatar: p.avatar || '👤',
    isAiGenerated: true,
  }))
}

/* ── 2) 시안 분석 ── */

export interface AnalysisResult {
  axisScores: AxisScore[]
  findings: Finding[]
  taskMetrics: TaskMetrics
  overallSummary: string
  walkthrough: WalkStep[]
  abComparison?: ABComparison
}

const analysisSchema = {
  type: 'OBJECT',
  properties: {
    walkthrough: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          frameId: { type: 'STRING' },
          personaName: { type: 'STRING' },
          action: { type: 'STRING' },
          thought: { type: 'STRING' },
          emotion: {
            type: 'STRING',
            enum: ['positive', 'neutral', 'confused', 'frustrated'],
          },
        },
        required: ['frameId', 'personaName', 'action', 'thought', 'emotion'],
      },
    },
    axisScores: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          axis: { type: 'INTEGER' },
          label: { type: 'STRING' },
          score: { type: 'INTEGER' },
        },
        required: ['axis', 'label', 'score'],
      },
    },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          severity: {
            type: 'STRING',
            enum: ['critical', 'warning', 'suggestion'],
          },
          axis: { type: 'INTEGER' },
          axisLabel: { type: 'STRING' },
          heuristic: { type: 'STRING' },
          problem: { type: 'STRING' },
          taskMetric: { type: 'STRING' },
          suggestion: { type: 'STRING' },
          frameId: { type: 'STRING' },
        },
        required: [
          'severity',
          'axis',
          'axisLabel',
          'heuristic',
          'problem',
          'taskMetric',
          'suggestion',
        ],
      },
    },
    taskMetrics: {
      type: 'OBJECT',
      properties: {
        completionRate: { type: 'INTEGER' },
        avgClicks: { type: 'NUMBER' },
        errorRate: { type: 'INTEGER' },
        dropoffPoint: { type: 'STRING' },
      },
      required: ['completionRate', 'avgClicks', 'errorRate', 'dropoffPoint'],
    },
    overallSummary: { type: 'STRING' },
  },
  required: [
    'walkthrough',
    'axisScores',
    'findings',
    'taskMetrics',
    'overallSummary',
  ],
}

const variantScoresSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      variantId: { type: 'STRING', enum: ['A', 'B'] },
      axisScores: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            axis: { type: 'INTEGER' },
            label: { type: 'STRING' },
            score: { type: 'INTEGER' },
          },
          required: ['axis', 'label', 'score'],
        },
      },
      taskMetrics: {
        type: 'OBJECT',
        properties: {
          completionRate: { type: 'INTEGER' },
          avgClicks: { type: 'NUMBER' },
          errorRate: { type: 'INTEGER' },
          dropoffPoint: { type: 'STRING' },
        },
        required: ['completionRate', 'avgClicks', 'errorRate', 'dropoffPoint'],
      },
      strengths: {
        type: 'ARRAY',
        items: { type: 'STRING' },
      },
      weaknesses: {
        type: 'ARRAY',
        items: { type: 'STRING' },
      },
    },
    required: ['variantId', 'axisScores', 'taskMetrics', 'strengths', 'weaknesses'],
  },
}

const abAnalysisSchema = {
  ...analysisSchema,
  properties: {
    ...analysisSchema.properties,
    abComparison: {
      type: 'OBJECT',
      properties: {
        winner: { type: 'STRING', enum: ['A', 'B', 'tie'] },
        confidence: { type: 'INTEGER' },
        summary: { type: 'STRING' },
        recommendation: { type: 'STRING' },
        keyInsights: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
        variantScores: variantScoresSchema,
        personaPreferences: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              personaId: { type: 'STRING' },
              personaName: { type: 'STRING' },
              preferredVariant: { type: 'STRING', enum: ['A', 'B', 'tie'] },
              reason: { type: 'STRING' },
            },
            required: ['personaName', 'preferredVariant', 'reason'],
          },
        },
      },
      required: [
        'winner',
        'confidence',
        'summary',
        'recommendation',
        'keyInsights',
        'variantScores',
        'personaPreferences',
      ],
    },
  },
  required: [...analysisSchema.required, 'abComparison'],
}

interface RawAnalysis {
  walkthrough: WalkStep[]
  axisScores: { axis: number; label: string; score: number }[]
  findings: Omit<Finding, 'id'>[]
  taskMetrics: TaskMetrics
  overallSummary: string
  abComparison?: RawABComparison
}

interface RawABComparison {
  winner: VariantId | 'tie'
  confidence: number
  summary: string
  recommendation: string
  keyInsights: string[]
  variantScores: {
    variantId: VariantId
    axisScores: { axis: number; label: string; score: number }[]
    taskMetrics: TaskMetrics
    strengths: string[]
    weaknesses: string[]
  }[]
  personaPreferences: {
    personaId?: string
    personaName: string
    preferredVariant: VariantId | 'tie'
    reason: string
  }[]
}

function normalizeAxisScores(
  rawScores: { axis: number; label: string; score: number }[] = []
): AxisScore[] {
  const iconByAxis = new Map(AXES.map((a) => [a.axis, a.icon]))
  return rawScores.map((score) => ({
    axis: score.axis,
    label: score.label,
    score: Math.max(0, Math.min(100, Math.round(score.score))),
    icon: iconByAxis.get(score.axis) ?? '📊',
  }))
}

function normalizeVariantId(value: string | undefined): VariantId | 'tie' {
  if (value === 'A' || value === 'B' || value === 'tie') return value
  return 'tie'
}

function normalizeABComparison(raw: RawABComparison | undefined): ABComparison | undefined {
  if (!raw) return undefined

  return {
    winner: normalizeVariantId(raw.winner),
    confidence: Math.max(0, Math.min(100, Math.round(raw.confidence ?? 0))),
    summary: raw.summary ?? '',
    recommendation: raw.recommendation ?? '',
    keyInsights: raw.keyInsights ?? [],
    variantScores: (raw.variantScores ?? []).map((variant) => ({
      variantId: normalizeVariantId(variant.variantId) === 'B' ? 'B' : 'A',
      axisScores: normalizeAxisScores(variant.axisScores),
      taskMetrics: variant.taskMetrics,
      strengths: variant.strengths ?? [],
      weaknesses: variant.weaknesses ?? [],
    })),
    personaPreferences: (raw.personaPreferences ?? []).map((preference) => ({
      personaId: preference.personaId,
      personaName: preference.personaName,
      preferredVariant: normalizeVariantId(preference.preferredVariant),
      reason: preference.reason,
    })),
  }
}

export async function analyzeDesign(
  apiKey: string,
  model: string,
  frames: FrameInput[],
  personas: PersonaConfig[]
): Promise<AnalysisResult> {
  const frameParts = await buildFrameParts(frames)
  const text = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [
          ...frameParts,
          {
            text: analysisPrompt(
              personas,
              frames.map((f) => ({ id: f.id, name: f.name }))
            ),
          },
        ],
      },
    ],
    responseSchema: analysisSchema,
    temperature: 0.6,
  })

  const raw = parseJson<RawAnalysis>(text)

  const axisScores = normalizeAxisScores(raw.axisScores)

  const findings: Finding[] = (raw.findings ?? []).map((f, i) => ({
    id: `f-${i + 1}`,
    ...f,
  }))

  return {
    axisScores,
    findings,
    taskMetrics: raw.taskMetrics,
    overallSummary: raw.overallSummary,
    walkthrough: raw.walkthrough ?? [],
  }
}

export async function analyzeABDesign(
  apiKey: string,
  model: string,
  variants: DesignVariant[],
  personas: PersonaConfig[],
  abConfig: ABTestConfig
): Promise<AnalysisResult> {
  const variantParts = await buildVariantParts(variants)
  const text = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [
          ...variantParts,
          {
            text: abAnalysisPrompt(personas, variants, abConfig),
          },
        ],
      },
    ],
    responseSchema: abAnalysisSchema,
    temperature: 0.6,
  })

  const raw = parseJson<RawAnalysis>(text)
  const findings: Finding[] = (raw.findings ?? []).map((finding, index) => ({
    id: `f-${index + 1}`,
    ...finding,
  }))

  return {
    axisScores: normalizeAxisScores(raw.axisScores),
    findings,
    taskMetrics: raw.taskMetrics,
    overallSummary: raw.overallSummary,
    walkthrough: raw.walkthrough ?? [],
    abComparison: normalizeABComparison(raw.abComparison),
  }
}

/* ── 3) 인라인 채팅 ── */

export async function chatWithPersona(
  apiKey: string,
  model: string,
  frame: { name: string; file?: File; imageUrl: string } | null,
  persona: PersonaConfig,
  history: ChatMessage[],
  question: string
): Promise<string> {
  const firstParts: Part[] = []
  if (frame) {
    try {
      const img = await imageToBase64(frame.file ?? frame.imageUrl)
      firstParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
    } catch {
      /* 이미지 없이도 텍스트로 진행 */
    }
  }
  firstParts.push({
    text: `지금 보고 있는 화면: "${frame?.name ?? '제공된 화면'}". 이 화면을 사용하는 입장에서 답하세요.`,
  })

  const contents: Content[] = [
    { role: 'user', parts: firstParts },
    { role: 'model', parts: [{ text: '네, 화면 보고 있어요. 무엇이든 물어보세요.' }] },
  ]
  for (const m of history) {
    contents.push({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })
  }
  contents.push({ role: 'user', parts: [{ text: question }] })

  return generateContent({
    apiKey,
    model,
    systemInstruction: chatSystemPrompt(persona, frame?.name ?? '화면'),
    contents,
    temperature: 0.8,
  })
}
