/**
 * AI 분석 클라이언트.
 * 내 맥에서 실행 중인 로컬 브리지(bridge/server.mjs)를 거쳐 Claude 구독 계정으로 호출한다.
 * 프롬프트·스키마는 Gemini 시절 형식을 유지하고, 요청 직전에 Claude 형식으로 바꾼다.
 */

import type {
  ABComparison,
  ABTestConfig,
  AnalysisProgress,
  AnalysisRunContext,
  AnalysisStage,
  AnalysisValidation,
  DesignVariant,
  PersonaConfig,
  ScreenObservation,
  AxisScore,
  Finding,
  FlowJudgment,
  FlowOutcome,
  FlowRun,
  FlowTestConfig,
  FlowTestResult,
  Frame,
  TaskMetrics,
  WalkStep,
  ChatMessage,
  VariantId,
  FrameDesignContext,
} from '@/types'
import { imageToVisionImages } from '@/lib/image'
import { getFrameDisplayName, getFrameSecondaryLabel } from '@/lib/frameNaming'
import { createFlowTestResult, getFlowFrameLabel } from '@/lib/flow'
import {
  AXES,
  personaSuggestionPrompt,
  analysisPrompt,
  abAnalysisPrompt,
  chatSystemPrompt,
  flowAnalystPrompt,
} from './prompts'
import { validateAnalysisEvidence, withMetricProvenance } from './validation'
import { formatJudgment, judgeFlowRuns, matchFlowEdge } from './judge'
import {
  AnalysisAbortedError,
  DEFAULT_MAX_ATTEMPTS,
  PermanentAnalysisError,
  backoffDelayMs,
  delay,
  isAbortError,
  isRetriableStatus,
  parseServerRetryDelayMs,
  throwIfAborted,
  type RetryNotice,
} from './retry'

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

interface GenerateOptions {
  /** 로컬 브리지 주소. 기존 API 키 저장소를 그대로 재사용한다. */
  apiKey: string
  model: string
  systemInstruction?: string
  contents: Content[]
  responseSchema?: unknown
  /** Claude는 temperature를 받지 않으므로 전달하지 않는다. */
  temperature?: number
  signal?: AbortSignal
  /** 재시도로 대기에 들어갈 때 호출된다. 진행 화면에 남은 시간을 보여주기 위한 것 */
  onRetry?: (notice: RetryNotice) => void
  maxAttempts?: number
}

/** 한 번의 요청 시도. 재시도 판단에 필요한 정보를 담아 던진다. */
class TransientGeminiError extends Error {
  // 생성자 파라미터 프로퍼티는 erasableSyntaxOnly에서 금지되므로 명시적으로 선언한다.
  retryAfterMs: number | null

  constructor(message: string, retryAfterMs: number | null) {
    super(message)
    this.name = 'TransientGeminiError'
    this.retryAfterMs = retryAfterMs
  }
}

type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * 브리지는 한 번에 사용자 메시지 하나만 받는다.
 * 여러 턴(채팅 기록)은 화자 표시를 붙여 하나의 메시지로 펼친다. 이미지는 순서대로 유지된다.
 */
function toClaudeContent(contents: Content[]): ClaudeBlock[] {
  const multiTurn = contents.length > 1
  const blocks: ClaudeBlock[] = []
  for (const content of contents) {
    if (multiTurn) {
      blocks.push({ type: 'text', text: content.role === 'user' ? '[사용자]' : '[나]' })
    }
    for (const part of content.parts) {
      if ('inlineData' in part) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data },
        })
      } else if (part.text) {
        blocks.push({ type: 'text', text: part.text })
      }
    }
  }
  if (multiTurn) {
    blocks.push({ type: 'text', text: '위 대화에 이어서, 마지막 [사용자] 메시지에 [나]로서 답하세요.' })
  }
  return blocks
}

/** Gemini 스키마(type: 'OBJECT' 등 대문자)를 JSON Schema(소문자)로 바꾼다. */
function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase()
    else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, toJsonSchema(child)])
      )
    } else out[key] = toJsonSchema(value)
  }
  return out
}

async function requestOnce(opts: GenerateOptions): Promise<string> {
  const url = `${opts.apiKey.replace(/\/+$/, '')}/generate`
  const body = {
    model: opts.model,
    system: opts.systemInstruction,
    content: toClaudeContent(opts.contents),
    schema: opts.responseSchema ? toJsonSchema(opts.responseSchema) : undefined,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw new AnalysisAbortedError()
    // 브리지가 꺼져 있으면 재시도해도 소용없다.
    throw new PermanentAnalysisError(
      '로컬 브리지에 연결할 수 없습니다. 터미널에서 `npm run bridge`가 실행 중인지, 브라우저의 로컬 네트워크 접근을 허용했는지 확인하세요.'
    )
  }

  if (!res.ok) {
    let parsed: unknown = null
    let detail = ''
    try {
      parsed = await res.json()
      detail = (parsed as { error?: string })?.error ?? ''
    } catch {
      /* 본문이 JSON이 아닐 수 있다 */
    }

    if (res.status === 401) {
      throw new PermanentAnalysisError(
        `Claude 로그인이 필요합니다. 터미널에서 \`claude auth login\`을 실행한 뒤 브리지를 다시 켜주세요.${detail ? ` (${detail})` : ''}`
      )
    }

    if (isRetriableStatus(res.status)) {
      const serverDelay = parseServerRetryDelayMs(parsed, res.headers.get('retry-after'))
      throw new TransientGeminiError(
        res.status === 429
          ? `Claude 구독 사용 한도에 걸렸습니다.${detail ? ` (${detail})` : ''}`
          : `Claude 응답에 실패했습니다.${detail ? ` (${detail})` : ` (HTTP ${res.status})`}`,
        serverDelay
      )
    }

    throw new PermanentAnalysisError(detail || `Claude 요청 실패 (HTTP ${res.status})`)
  }

  const data = (await res.json()) as { text?: string }
  const text = (data.text ?? '').trim()
  // 빈 응답은 재시도로 풀리는 경우가 많다.
  if (!text) throw new TransientGeminiError('Claude가 빈 응답을 반환했습니다.', null)
  return text
}

async function generateContent(opts: GenerateOptions): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let lastMessage = 'Claude 요청에 실패했습니다.'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(opts.signal)
    try {
      return await requestOnce(opts)
    } catch (error) {
      if (isAbortError(error)) throw new AnalysisAbortedError()
      if (error instanceof PermanentAnalysisError) throw error
      if (!(error instanceof TransientGeminiError)) throw error

      lastMessage = error.message
      if (attempt === maxAttempts) break

      const waitMs = error.retryAfterMs ?? backoffDelayMs(attempt)
      opts.onRetry?.({
        attempt,
        maxAttempts,
        waitMs,
        reason: error.message,
      })
      await delay(waitMs, opts.signal)
    }
  }

  throw new Error(
    `${lastMessage} ${maxAttempts}회 시도했지만 실패했습니다. 잠시 후 다시 시도하거나 더 가벼운 모델로 바꿔보세요.`
  )
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

type FrameInput = {
  id: string
  name: string
  originalName?: string
  userLabel?: string
  flowOrder?: number
  file?: File
  imageUrl: string
  designContext?: FrameDesignContext
}

function framePromptSecondary(frame: FrameInput): string {
  const secondary = getFrameSecondaryLabel(frame)
  return secondary ? ` | 보조명: ${secondary}` : ''
}

interface FramePartOptions {
  hideNames?: boolean
  hideOrder?: boolean
  imageDetail?: 'overview' | 'detailed'
  maxDetailImages?: number
}

function frameDesignContextText(frame: FrameInput): string | null {
  const context = frame.designContext
  if (!context || context.source !== 'figma_api') return null
  const lines = [
    context.dimensions
      ? `- 프레임 크기: ${context.dimensions.width}×${context.dimensions.height}`
      : '',
    context.visibleTexts.length > 0
      ? `- Figma 원문 텍스트: ${context.visibleTexts.map((text) => `"${text}"`).join(' / ')}`
      : '',
    context.interactiveLabels.length > 0
      ? `- Figma 프로토타입 상호작용 노드: ${context.interactiveLabels.join(' / ')}`
      : '',
    context.componentLabels.length > 0
      ? `- 컴포넌트/인스턴스: ${context.componentLabels.join(' / ')}`
      : '',
    context.structureLabels.length > 0
      ? `- 상위 구조: ${context.structureLabels.slice(0, 30).join(' / ')}`
      : '',
    context.prototypeTransitions.length > 0
      ? `- 프로토타입 연결: ${context.prototypeTransitions
          .map(
            (transition) =>
              `${transition.sourceNodeName} --${transition.trigger}/${transition.action}--> ${transition.destinationNodeId ?? '목적지 없음'}`
          )
          .join(' / ')}`
      : '',
  ].filter(Boolean)
  return lines.length > 0
    ? `Figma API에서 추출한 구조화 근거(이미지 판독보다 원문 텍스트와 연결 ID를 우선 신뢰):\n${lines.join('\n')}`
    : null
}

async function appendFrameImageParts(
  parts: Part[],
  source: File | string,
  options: FramePartOptions
): Promise<void> {
  const images = await imageToVisionImages(source, {
    includeDetails: options.imageDetail === 'detailed',
    maxDetailImages: options.maxDetailImages,
  })
  for (const image of images) {
    parts.push({ text: `이미지 보기: ${image.label}` })
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  }
}

async function buildFrameParts(
  frames: FrameInput[],
  options: FramePartOptions = {}
): Promise<Part[]> {
  const parts: Part[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    parts.push({
      text: options.hideNames
        ? `■ 화면 후보 | ID: ${f.id}`
        : `■ ${f.name}${
            options.hideOrder ? '' : ` | 순서: ${f.flowOrder ?? i + 1}`
          } | ID: ${f.id}${framePromptSecondary(f)}`,
    })
    const designContext = frameDesignContextText(f)
    if (designContext) parts.push({ text: designContext })
    if (f.file || f.imageUrl) {
      try {
        await appendFrameImageParts(parts, f.file ?? f.imageUrl, options)
      } catch {
        throw new Error(
          `"${getFrameDisplayName(f)}" 화면 이미지를 AI에 전달하지 못했습니다. Figma 화면 이미지를 다시 가져오거나 PNG/JPG로 업로드해주세요.`
        )
      }
    } else {
      parts.push({ text: '(아직 화면 이미지가 연결되지 않아 화면 메타데이터만 제공합니다.)' })
    }
  }
  return parts
}

async function buildVariantParts(
  variants: DesignVariant[],
  options: FramePartOptions = {}
): Promise<Part[]> {
  const parts: Part[] = []
  for (const variant of variants) {
    parts.push({ text: `■ ${variant.name} (${variant.id}안)` })
    for (let i = 0; i < variant.frames.length; i++) {
      const frame = variant.frames[i]
      parts.push({
        text: `■ ${variant.id}안 ${frame.name} | 순서: ${
          frame.flowOrder ?? i + 1
        } | ID: ${frame.id}${framePromptSecondary(frame)}`,
      })
      const designContext = frameDesignContextText(frame)
      if (designContext) parts.push({ text: designContext })
      if (frame.file || frame.imageUrl) {
        try {
          await appendFrameImageParts(parts, frame.file ?? frame.imageUrl, options)
        } catch {
          throw new Error(
            `"${getFrameDisplayName(frame)}" 화면 이미지를 AI에 전달하지 못했습니다. Figma 화면 이미지를 다시 가져오거나 PNG/JPG로 업로드해주세요.`
          )
        }
      } else {
        parts.push({ text: '(아직 화면 이미지가 연결되지 않아 화면 메타데이터만 제공합니다.)' })
      }
    }
  }
  return parts
}

const screenObservationSchema = {
  type: 'OBJECT',
  properties: {
    screens: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          frameId: { type: 'STRING' },
          summary: { type: 'STRING' },
          visibleTexts: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          interactiveElements: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                label: { type: 'STRING' },
                role: { type: 'STRING' },
                location: { type: 'STRING' },
                confidence: { type: 'INTEGER' },
              },
              required: ['label', 'role', 'location', 'confidence'],
            },
          },
          unreadableAreas: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: [
          'frameId',
          'summary',
          'visibleTexts',
          'interactiveElements',
          'unreadableAreas',
        ],
      },
    },
  },
  required: ['screens'],
}

function observationPrompt(frames: FrameInput[]): string {
  const frameIds = frames.map((frame) => frame.id).join(', ')
  return `당신은 UI 화면 판독기입니다. 이어지는 전체 화면 축소본과 상세 구간 이미지를 먼저 관찰하세요.
같은 화면 ID 아래의 전체 화면과 상세 구간은 한 화면의 서로 다른 보기입니다.

## 판독 대상 화면 ID
${frameIds}

## 판독 규칙
1. 이미지에서 실제로 확인한 정보만 기록하고 보이지 않는 문구나 조작 요소를 추측하지 마세요.
2. visibleTexts에는 의미 있는 제목, 설명, 레이블, 상태, CTA 문구를 가능한 한 원문 그대로 기록하세요.
3. interactiveElements에는 버튼, 링크, 탭, 입력창, 메뉴, 카드 등 조작 가능해 보이는 요소를 기록하세요.
4. label은 화면에 보이는 문구를 우선 사용하고, 문구가 없는 아이콘은 시각적 특징을 설명하세요.
5. location은 상단/중앙/하단 및 좌/중앙/우를 조합해 구체적으로 작성하세요.
6. confidence는 해당 요소를 실제로 읽었다는 확신을 0~100으로 기록하세요.
7. 흐릿하거나 잘려서 읽지 못한 곳은 unreadableAreas에 명시하세요.
8. Figma API 구조화 근거가 함께 제공되면 원문 텍스트와 prototype destination ID는 그 데이터를 우선 신뢰하세요.
9. 화면별 결과를 반드시 해당 frameId와 연결하고 지정된 JSON 스키마만 반환하세요.`
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeObservation(
  frame: FrameInput,
  observation: ScreenObservation | undefined
): ScreenObservation {
  return {
    frameId: frame.id,
    summary: observation?.summary?.trim() || '화면 판독 결과 없음',
    visibleTexts: (observation?.visibleTexts ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 40),
    interactiveElements: (observation?.interactiveElements ?? [])
      .filter((element) => element.label?.trim())
      .slice(0, 30)
      .map((element) => ({
        label: element.label.trim(),
        role: element.role?.trim() || '기타',
        location: element.location?.trim() || '위치 불명',
        confidence: clampConfidence(element.confidence),
      })),
    unreadableAreas: (observation?.unreadableAreas ?? [])
      .map((area) => area.trim())
      .filter(Boolean)
      .slice(0, 10),
  }
}

/** 단계별 진행 보고를 위한 헬퍼. onProgress가 없으면 아무 일도 하지 않는다. */
function reportProgress(
  context: AnalysisRunContext | undefined,
  stage: AnalysisStage,
  completed: number,
  total: number,
  retry?: AnalysisProgress['retry']
): void {
  context?.onProgress?.({ stage, completed, total, retry })
}

/** 해당 단계의 재시도 알림을 진행 보고로 전달하는 콜백을 만든다. */
function retryReporter(
  context: AnalysisRunContext | undefined,
  stage: AnalysisStage,
  completed: number,
  total: number
): (notice: RetryNotice) => void {
  return (notice) => reportProgress(context, stage, completed, total, notice)
}

async function observeScreens(
  apiKey: string,
  model: string,
  frames: FrameInput[],
  options: Pick<FramePartOptions, 'hideNames' | 'hideOrder'> = {},
  context?: AnalysisRunContext
): Promise<ScreenObservation[]> {
  const observations: ScreenObservation[] = []
  const batchSize = 4
  const batchCount = Math.max(1, Math.ceil(frames.length / batchSize))

  reportProgress(context, 'observe', 0, batchCount)

  for (let start = 0; start < frames.length; start += batchSize) {
    throwIfAborted(context?.signal)
    const batchIndex = Math.floor(start / batchSize)
    const batch = frames.slice(start, start + batchSize)
    const imageParts = await buildFrameParts(batch, {
      ...options,
      imageDetail: 'detailed',
      maxDetailImages: 5,
    })
    const text = await generateContent({
      apiKey,
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: observationPrompt(batch) }, ...imageParts],
        },
      ],
      responseSchema: screenObservationSchema,
      temperature: 0.1,
      signal: context?.signal,
      onRetry: retryReporter(context, 'observe', batchIndex, batchCount),
    })
    const parsed = parseJson<{ screens: ScreenObservation[] }>(text)
    for (const frame of batch) {
      observations.push(
        normalizeObservation(
          frame,
          (parsed.screens ?? []).find((screen) => screen.frameId === frame.id)
        )
      )
    }
    reportProgress(context, 'observe', batchIndex + 1, batchCount)
  }

  return observations
}

function formatScreenObservations(observations: ScreenObservation[]): string {
  return observations
    .map((screen) => {
      const texts = screen.visibleTexts.length > 0 ? screen.visibleTexts.join(' / ') : '확인된 문구 없음'
      const elements =
        screen.interactiveElements.length > 0
          ? screen.interactiveElements
              .map(
                (element) =>
                  `"${element.label}"(${element.role}, ${element.location}, 확신 ${element.confidence})`
              )
              .join(' / ')
          : '확인된 조작 요소 없음'
      const unreadable =
        screen.unreadableAreas.length > 0
          ? screen.unreadableAreas.join(' / ')
          : '특이사항 없음'
      return `[화면 ID: ${screen.frameId}]
- 요약: ${screen.summary}
- 실제 확인 문구: ${texts}
- 실제 확인 조작 요소: ${elements}
- 판독 불가 영역: ${unreadable}`
    })
    .join('\n\n')
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
        parts: [{ text: personaSuggestionPrompt(frames.length) }, ...frameParts],
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
  flowResult?: FlowTestResult
  flowJudgment?: FlowJudgment
  validation?: AnalysisValidation
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
          observedElement: { type: 'STRING' },
          evidence: { type: 'STRING' },
          confidence: { type: 'INTEGER' },
          thought: { type: 'STRING' },
          emotion: {
            type: 'STRING',
            enum: ['positive', 'neutral', 'confused', 'frustrated'],
          },
        },
        required: [
          'frameId',
          'personaName',
          'action',
          'observedElement',
          'evidence',
          'confidence',
          'thought',
          'emotion',
        ],
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
          evidence: { type: 'STRING' },
          confidence: { type: 'INTEGER' },
        },
        required: [
          'severity',
          'axis',
          'axisLabel',
          'heuristic',
          'problem',
          'taskMetric',
          'suggestion',
          'evidence',
          'confidence',
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
      taskMetrics: withMetricProvenance(variant.taskMetrics, 'ai_estimate'),
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
  personas: PersonaConfig[],
  context?: AnalysisRunContext
): Promise<AnalysisResult> {
  const checkpoint = context?.checkpoint
  let observations = checkpoint?.observations
  if (!observations) {
    observations = await observeScreens(apiKey, model, frames, {}, context)
    if (checkpoint) checkpoint.observations = observations
  } else {
    reportProgress(context, 'observe', 1, 1)
  }
  const frameParts = await buildFrameParts(frames, { imageDetail: 'overview' })
  const groundedPrompt = `${analysisPrompt(personas, frames)}

## 사전 화면 판독 결과
아래 내용은 같은 이미지의 고해상도 상세 구간에서 먼저 추출한 관찰 결과입니다.
행동과 문제점을 작성할 때 실제 확인 문구와 조작 요소를 근거로 사용하세요.
판독 결과와 전체 화면이 충돌하면 추측하지 말고 불확실성을 명시하세요.

${formatScreenObservations(observations)}`
  reportProgress(context, 'analyze', 0, 1)
  const text = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: groundedPrompt,
          },
          ...frameParts,
        ],
      },
    ],
    responseSchema: analysisSchema,
    temperature: 0.6,
    signal: context?.signal,
    onRetry: retryReporter(context, 'analyze', 0, 1),
  })

  const raw = parseJson<RawAnalysis>(text)
  reportProgress(context, 'analyze', 1, 1)

  const axisScores = normalizeAxisScores(raw.axisScores)

  const rawFindings: Finding[] = (raw.findings ?? []).map((f, i) => ({
    id: `f-${i + 1}`,
    ...f,
    confidence: f.confidence === undefined ? undefined : clampConfidence(f.confidence),
  }))
  const validated = validateAnalysisEvidence({
    frames,
    observations,
    findings: rawFindings,
    walkthrough: raw.walkthrough ?? [],
    taskMetrics: raw.taskMetrics,
  })

  return {
    axisScores,
    findings: validated.findings,
    taskMetrics: validated.taskMetrics,
    overallSummary: raw.overallSummary,
    walkthrough: validated.walkthrough,
    validation: validated.validation,
  }
}

interface RawFlowStep {
  action: string
  observedElement: string
  evidence: string
  confidence: number
  targetFrameId?: string
  expectation: string
  thought: string
  emotion: WalkStep['emotion']
  durationSeconds?: number
  friction?: string
  recommendation?: string
}

interface RawFlowInterview {
  question: string
  answer: string
}

interface RawFlowRun {
  personaId?: string
  personaName: string
  outcome?: FlowOutcome
  steps: RawFlowStep[]
  interview?: RawFlowInterview[]
  summary: string
}

/** 페르소나 테스터 산출물 — 행동 기록만 */
interface RawFlowRunSet {
  runs: RawFlowRun[]
}

/** UX 분석기 산출물 — 판정 결과를 받아 만든 문제·점수·총평 */
interface RawFlowAnalysis {
  axisScores: { axis: number; label: string; score: number }[]
  findings: Omit<Finding, 'id'>[]
  overallSummary: string
}

const flowTesterSchema = {
  type: 'OBJECT',
  properties: {
    runs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          personaId: { type: 'STRING' },
          personaName: { type: 'STRING' },
          outcome: {
            type: 'STRING',
            enum: ['success', 'partial', 'failed', 'abandoned'],
          },
          steps: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                action: { type: 'STRING' },
                observedElement: { type: 'STRING' },
                evidence: { type: 'STRING' },
                confidence: { type: 'INTEGER' },
                targetFrameId: { type: 'STRING' },
                expectation: { type: 'STRING' },
                thought: { type: 'STRING' },
                emotion: {
                  type: 'STRING',
                  enum: ['positive', 'neutral', 'confused', 'frustrated'],
                },
                durationSeconds: { type: 'NUMBER' },
                friction: { type: 'STRING' },
                recommendation: { type: 'STRING' },
              },
              required: [
                'action',
                'observedElement',
                'evidence',
                'confidence',
                'expectation',
                'thought',
                'emotion',
                'durationSeconds',
              ],
            },
          },
          interview: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                question: { type: 'STRING' },
                answer: { type: 'STRING' },
              },
              required: ['question', 'answer'],
            },
          },
          summary: { type: 'STRING' },
        },
        required: ['personaName', 'outcome', 'steps', 'interview', 'summary'],
      },
    },
  },
  required: ['runs'],
}

const flowAnalystSchema = {
  type: 'OBJECT',
  properties: {
    axisScores: analysisSchema.properties.axisScores,
    findings: analysisSchema.properties.findings,
    overallSummary: { type: 'STRING' },
  },
  required: ['axisScores', 'findings', 'overallSummary'],
}

/**
 * 페르소나 테스터 프롬프트.
 * 이 단계의 산출물은 "행동 기록"뿐이다. UX 평가·점수·문제 도출은
 * 별도의 UX 분석기(flowAnalystPrompt)가 판정 결과를 받아 수행한다.
 * 한 요청에 관찰·연기·평가를 섞지 않기 위한 분리다.
 */
function flowTesterPrompt(
  personas: PersonaConfig[],
  frames: Frame[],
  config: FlowTestConfig
): string {
  const frameText = frames
    .map((frame) => `- 화면 후보 ID: ${frame.id}`)
    .join('\n')
  const personaText = personas
    .map(
      (persona) =>
        `- ${persona.name} | ID:${persona.id} | 역할:${persona.role} | 디지털:${persona.digitalLevel} | 목표:${persona.goal} | 맥락:${persona.context}`
    )
    .join('\n')

  return `당신은 UX 리서처이자 독립적인 AI 사용성 테스터입니다.
아래 테스트는 화면별 감상평이 아니라, 각 페르소나가 진입 화면에서 하나의 미션을 수행하는 Flow UT입니다.

## 테스트
- 테스트명: ${config.title}
- 시나리오: ${config.scenario}
- 미션: ${config.mission}
- 진입 화면 ID: ${config.entryFrameId}
- 최대 행동 단계: ${config.maxSteps}

## 화면 후보
${frameText}

## 페르소나
${personaText}

## 실행 규칙
1. 각 페르소나는 서로 영향을 받지 않는 독립적인 run 1개를 수행합니다.
2. 모든 run은 진입 화면에서 시작합니다.
3. 화면 연결, 기대 행동, 성공 화면은 제공되지 않습니다. 정답 경로나 화면 나열 순서를 힌트로 사용하지 마세요.
4. 매 단계에서 현재 화면 이미지만 보고 실제로 보이는 요소 중 하나를 스스로 선택하고, action에 구체적인 선택 행동을 작성하세요.
   - observedElement: 실제로 선택한 요소의 화면 문구 또는 시각적 특징
   - evidence: 그 요소가 현재 화면에 있다는 직접적인 관찰 근거
   - confidence: 요소 판독 확신도(0~100)
5. targetFrameId에는 그 행동 후 나타날 것으로 예상되는 화면 후보 ID를 작성하세요. 맞는 후보를 찾을 수 없다면 생략하세요.
6. 다음 단계에서는 직전에 예측한 화면을 현재 화면으로 삼아 같은 방식으로 판단하세요.
7. 행동할 요소를 찾지 못하면 존재하지 않는 버튼을 만들지 말고 friction에 막힌 이유를 기록하세요.
8. 혼란, 기대 불일치, 되돌림 필요가 있으면 friction과 recommendation에 구체적으로 기록하세요.
9. Think Aloud 방식으로 행동 직전의 솔직한 생각을 thought에 1인칭으로 작성하세요.
10. 각 단계에서 화면을 이해하고 행동을 결정하는 데 걸릴 것으로 예상되는 시간을 durationSeconds에 1~120초로 작성하세요. 실제 사람의 측정 시간이 아닌 AI 추정치입니다.
11. run을 마친 뒤 아래 3가지 사후 인터뷰에 해당 페르소나의 말투로 답하세요.
   - 첫 행동을 왜 선택했나요?
   - 가장 망설였던 순간은 언제였나요?
   - 이 흐름에서 가장 바꾸고 싶은 점은 무엇인가요?

## 결과
- runs: 페르소나별로 스스로 선택한 행동, 예상 화면, Think Aloud, 단계별 예상 시간, 마찰, 사후 인터뷰를 작성

당신의 역할은 "행동하는 사용자"까지입니다.
UX 점수 매기기, 문제 목록 작성, 총평은 당신의 일이 아닙니다. 행동과 그때의 생각만 기록하세요.
스스로 잘했는지 평가하지도 마세요.

모든 텍스트는 한국어로 작성하고 지정된 JSON 스키마만 반환하세요.`
}

function normalizeFlowRuns(
  rawRuns: RawFlowRun[],
  personas: PersonaConfig[],
  config: FlowTestConfig
): FlowRun[] {
  return personas.map((persona, personaIndex) => {
    const raw =
      rawRuns.find((run) => run.personaId === persona.id) ??
      rawRuns.find((run) => run.personaName === persona.name) ??
      rawRuns[personaIndex]
    let currentFrameId = config.entryFrameId
    const events: FlowRun['events'] = []

    for (const [stepIndex, step] of (raw?.steps ?? []).slice(0, config.maxSteps).entries()) {
      if (currentFrameId === config.successFrameId) break
      const outgoing = config.edges.filter((edge) => edge.fromFrameId === currentFrameId)
      const requestedAction = step.action?.trim() ?? ''
      const edge = matchFlowEdge(outgoing, step)
      const expectedAction =
        outgoing.length > 0 ? outgoing.map((item) => item.actionLabel).join(' / ') : undefined

      if (!edge) {
        events.push({
          id: `flow-event-${persona.id}-${stepIndex + 1}`,
          step: stepIndex + 1,
          fromFrameId: currentFrameId,
          action: requestedAction || '다음 행동을 찾는다',
          expectation: step.expectation ?? '과업을 계속 진행할 수 있기를 기대한다.',
          thought: step.thought ?? '선택할 수 있는 다음 경로를 찾지 못했다.',
          emotion: step.emotion ?? 'frustrated',
          estimatedDurationSeconds: Math.max(
            1,
            Math.min(120, Math.round(step.durationSeconds ?? 15))
          ),
          expectedAction,
          transitionMatched: false,
          aiExpectedFrameId: step.targetFrameId?.trim() || undefined,
          observedElement: step.observedElement?.trim() || undefined,
          evidence: step.evidence?.trim() || undefined,
          confidence: clampConfidence(step.confidence),
          friction:
            step.friction?.trim() ||
            '스스로 선택한 행동이 실제 화면 흐름과 연결되지 않음',
          recommendation:
            step.recommendation?.trim() ||
            '사용자가 다음 단계로 이어지는 요소와 그 결과를 화면만 보고 예측할 수 있게 개선하세요.',
        })
        break
      }

      events.push({
        id: `flow-event-${persona.id}-${stepIndex + 1}`,
        step: stepIndex + 1,
        fromFrameId: currentFrameId,
        toFrameId: edge.toFrameId,
        action: requestedAction || edge.actionLabel,
        expectation: step.expectation ?? '',
        thought: step.thought ?? '',
        emotion: step.emotion ?? 'neutral',
        estimatedDurationSeconds: Math.max(
          1,
          Math.min(120, Math.round(step.durationSeconds ?? 8))
        ),
        expectedAction: edge.actionLabel,
        transitionMatched: true,
        aiExpectedFrameId: step.targetFrameId?.trim() || undefined,
        observedElement: step.observedElement?.trim() || undefined,
        evidence: step.evidence?.trim() || undefined,
        confidence: clampConfidence(step.confidence),
        friction: step.friction?.trim() || undefined,
        recommendation: step.recommendation?.trim() || undefined,
      })
      currentFrameId = edge.toFrameId
    }

    const outcome: FlowOutcome =
      currentFrameId === config.successFrameId
        ? 'success'
        : events.length >= config.maxSteps
        ? 'abandoned'
        : raw?.outcome === 'partial'
        ? 'partial'
        : 'failed'

    return {
      id: `flow-run-${persona.id}`,
      personaId: persona.id,
      personaName: persona.name,
      outcome,
      events,
      interview: (raw?.interview ?? [])
        .filter((item) => item.question?.trim() && item.answer?.trim())
        .slice(0, 3)
        .map((item) => ({
          question: item.question.trim(),
          answer: item.answer.trim(),
        })),
      summary:
        raw?.summary?.trim() ||
        (outcome === 'success'
          ? `${persona.name}은(는) 미션을 완료했습니다.`
          : `${persona.name}은(는) 미션을 완료하지 못했습니다.`),
    }
  })
}

/** UX 분석기에 넘길 행동 기록 요약. 이미지는 넘기지 않는다. */
function formatRunsForAnalyst(runs: FlowRun[], frames: Frame[]): string {
  if (runs.length === 0) return '기록된 행동이 없습니다.'

  return runs
    .map((run) => {
      const steps = run.events
        .map((event) => {
          const lines = [
            `  ${event.step}. [${getFlowFrameLabel(frames, event.fromFrameId)}] ${event.action}`,
            event.observedElement ? `     선택한 요소: "${event.observedElement}"` : '',
            event.thought ? `     생각: ${event.thought}` : '',
            `     감정: ${event.emotion}`,
            event.friction ? `     마찰: ${event.friction}` : '',
          ]
          return lines.filter(Boolean).join('\n')
        })
        .join('\n')
      const interview = (run.interview ?? [])
        .map((item) => `     Q. ${item.question}\n     A. ${item.answer}`)
        .join('\n')
      return `### ${run.personaName} — 결과: ${run.outcome}
${steps || '  (행동 없음)'}${interview ? `\n  사후 인터뷰:\n${interview}` : ''}`
    })
    .join('\n\n')
}

export async function analyzeFlowDesign(
  apiKey: string,
  model: string,
  frames: Frame[],
  personas: PersonaConfig[],
  config: FlowTestConfig,
  context?: AnalysisRunContext
): Promise<AnalysisResult> {
  const checkpoint = context?.checkpoint
  const blindFrames = [...frames].sort((a, b) => a.id.localeCompare(b.id))

  /* ── 1단계: 관찰기 ────────────────────────────────────────
   * 이미 판독을 마쳤다면(재시도) 다시 호출하지 않는다.
   */
  let observations = checkpoint?.observations
  if (!observations) {
    observations = await observeScreens(
      apiKey,
      model,
      blindFrames,
      { hideNames: true, hideOrder: true },
      context
    )
    if (checkpoint) checkpoint.observations = observations
  } else {
    reportProgress(context, 'observe', 1, 1)
  }

  const frameParts = await buildFrameParts(blindFrames, {
    hideNames: true,
    hideOrder: true,
    imageDetail: 'overview',
  })
  /* ── 2단계: 페르소나 테스터 (블라인드 행동) ────────────────
   * 설계 의도·연결·성공 화면을 주지 않는다. 산출물은 행동 기록뿐이다.
   */
  let runs = checkpoint?.flowRuns
  if (!runs) {
    reportProgress(context, 'test', 0, 1)
    const testerPrompt = `${flowTesterPrompt(personas, blindFrames, config)}

## 사전 화면 판독 결과
아래에는 고해상도 상세 구간에서 실제로 확인한 문구와 조작 요소만 정리되어 있습니다.
각 action은 반드시 현재 화면 ID의 확인된 조작 요소 중 하나를 근거로 선택하세요.
확인되지 않은 버튼이나 링크를 만들어내지 마세요.

${formatScreenObservations(observations)}`
    const testerText = await generateContent({
      apiKey,
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: testerPrompt }, ...frameParts],
        },
      ],
      responseSchema: flowTesterSchema,
      temperature: 0.65,
      signal: context?.signal,
      onRetry: retryReporter(context, 'test', 0, 1),
    })
    const rawRuns = parseJson<RawFlowRunSet>(testerText)
    runs = normalizeFlowRuns(rawRuns.runs ?? [], personas, config)
    if (checkpoint) checkpoint.flowRuns = runs
  }
  reportProgress(context, 'test', 1, 1)

  /* ── 3단계: 판정기 (코드) ──────────────────────────────────
   * LLM을 쓰지 않는다. 같은 입력이면 항상 같은 판정이 나와야
   * 모델 교체·실제 사용자 테스트와의 비교가 성립한다.
   * 네트워크를 타지 않으므로 실패하지 않고, 체크포인트도 필요 없다.
   */
  reportProgress(context, 'judge', 0, 1)
  const judgment = judgeFlowRuns(runs, config, frames)
  reportProgress(context, 'judge', 1, 1)

  /* ── 4단계: UX 분석기 ─────────────────────────────────────
   * 화면을 다시 해석하지 않는다. 관찰 사실과 확정된 판정만 근거로 쓴다.
   * 이미지를 넘기지 않아 앞 단계보다 가볍다.
   */
  reportProgress(context, 'analyze', 0, 1)
  const analystText = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${flowAnalystPrompt(config)}

## 1. 화면 판독 결과
${formatScreenObservations(observations)}

## 2. 행동 기록
${formatRunsForAnalyst(runs, frames)}

## 3. 설계 의도 대조 판정
${formatJudgment(judgment, frames)}`,
          },
        ],
      },
    ],
    responseSchema: flowAnalystSchema,
    temperature: 0.4,
    signal: context?.signal,
    onRetry: retryReporter(context, 'analyze', 0, 1),
  })
  const raw = parseJson<RawFlowAnalysis>(analystText)
  reportProgress(context, 'analyze', 1, 1)

  const flowResult = createFlowTestResult(config, runs, raw.overallSummary ?? '')
  const findings: Finding[] = (raw.findings ?? []).map((finding, index) => ({
    id: `flow-f-${index + 1}`,
    ...finding,
    confidence:
      finding.confidence === undefined ? undefined : clampConfidence(finding.confidence),
  }))

  if (findings.length === 0) {
    findings.push(
      ...flowResult.frictions.map((friction, index) => ({
        id: `flow-fallback-${index + 1}`,
        severity: friction.severity,
        axis: 3,
        axisLabel: '핵심 태스크 완료',
        heuristic: '과업 흐름',
        problem: friction.description,
        taskMetric: `${friction.affectedRunCount}개 run에서 발생`,
        suggestion: friction.recommendation,
        frameId: friction.frameId,
      }))
    )
  }

  const rawWalkthrough = runs.flatMap((run) =>
    run.events.map((event) => ({
      frameId: event.fromFrameId,
      personaName: run.personaName,
      action: event.action,
      thought: event.thought,
      emotion: event.emotion,
      observedElement: event.observedElement,
      evidence: event.evidence,
      confidence: event.confidence,
    }))
  )
  const rawTaskMetrics: TaskMetrics = {
    completionRate: flowResult.metrics.successRate,
    avgClicks: flowResult.metrics.avgSteps,
    errorRate: 100 - flowResult.metrics.successRate,
    dropoffPoint: flowResult.metrics.dropoffFrameId
      ? getFlowFrameLabel(frames, flowResult.metrics.dropoffFrameId)
      : '뚜렷한 이탈 지점 없음',
  }
  const validated = validateAnalysisEvidence({
    frames,
    observations,
    findings,
    walkthrough: rawWalkthrough,
    taskMetrics: rawTaskMetrics,
    metricProvenance: 'simulation_aggregate',
  })
  let validatedStepIndex = 0
  const validatedFlowResult: FlowTestResult = {
    ...flowResult,
    runs: flowResult.runs.map((run) => ({
      ...run,
      events: run.events.map((event) => {
        const step = validated.walkthrough[validatedStepIndex++]
        return step
          ? {
              ...event,
              confidence: step.confidence,
              verification: step.verification,
              matchedEvidence: step.matchedEvidence,
            }
          : event
      }),
    })),
  }

  return {
    axisScores: normalizeAxisScores(raw.axisScores),
    findings: validated.findings,
    taskMetrics: validated.taskMetrics,
    overallSummary: raw.overallSummary ?? '',
    walkthrough: validated.walkthrough,
    flowResult: validatedFlowResult,
    flowJudgment: judgment,
    validation: validated.validation,
  }
}

export async function analyzeABDesign(
  apiKey: string,
  model: string,
  variants: DesignVariant[],
  personas: PersonaConfig[],
  abConfig: ABTestConfig,
  context?: AnalysisRunContext
): Promise<AnalysisResult> {
  const checkpoint = context?.checkpoint
  const observationFrames = variants.flatMap((variant) =>
    variant.frames.map((frame) => ({
      ...frame,
      name: `${variant.id}안 ${frame.name}`,
      userLabel: `${variant.name} · ${getFrameDisplayName(frame)}`,
    }))
  )
  let observations = checkpoint?.observations
  if (!observations) {
    observations = await observeScreens(apiKey, model, observationFrames, {}, context)
    if (checkpoint) checkpoint.observations = observations
  } else {
    reportProgress(context, 'observe', 1, 1)
  }
  const variantParts = await buildVariantParts(variants, { imageDetail: 'overview' })
  const groundedPrompt = `${abAnalysisPrompt(personas, variants, abConfig)}

## 사전 화면 판독 결과
아래는 각 시안의 고해상도 상세 구간에서 실제 확인한 문구와 조작 요소입니다.
A/B 차이와 발견점은 반드시 이 관찰 결과 또는 이어지는 전체 화면에서 확인되는 근거와 연결하세요.

${formatScreenObservations(observations)}`
  const text = await generateContent({
    apiKey,
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: groundedPrompt,
          },
          ...variantParts,
        ],
      },
    ],
    responseSchema: abAnalysisSchema,
    temperature: 0.6,
    signal: context?.signal,
    onRetry: retryReporter(context, 'analyze', 0, 1),
  })

  const raw = parseJson<RawAnalysis>(text)
  reportProgress(context, 'analyze', 1, 1)
  const findings: Finding[] = (raw.findings ?? []).map((finding, index) => ({
    id: `f-${index + 1}`,
    ...finding,
    confidence:
      finding.confidence === undefined ? undefined : clampConfidence(finding.confidence),
  }))

  const validated = validateAnalysisEvidence({
    frames: observationFrames,
    observations,
    findings,
    walkthrough: raw.walkthrough ?? [],
    taskMetrics: raw.taskMetrics,
  })

  return {
    axisScores: normalizeAxisScores(raw.axisScores),
    findings: validated.findings,
    taskMetrics: validated.taskMetrics,
    overallSummary: raw.overallSummary,
    walkthrough: validated.walkthrough,
    abComparison: normalizeABComparison(raw.abComparison),
    validation: validated.validation,
  }
}

/* ── 3) 인라인 채팅 ── */

export async function chatWithPersona(
  apiKey: string,
  model: string,
  frame: {
    name: string
    originalName?: string
    userLabel?: string
    file?: File
    imageUrl: string
  } | null,
  persona: PersonaConfig,
  history: ChatMessage[],
  question: string
): Promise<string> {
  const firstParts: Part[] = []
  if (frame) {
    try {
      const images = await imageToVisionImages(frame.file ?? frame.imageUrl, {
        includeDetails: true,
        maxDetailImages: 4,
      })
      for (const image of images) {
        firstParts.push({ text: `현재 화면 보기: ${image.label}` })
        firstParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
      }
    } catch {
      /* 이미지 없이도 텍스트로 진행 */
    }
  }
  const frameName = frame ? getFrameDisplayName(frame) : '제공된 화면'
  firstParts.push({
    text: `지금 보고 있는 화면: "${frameName}". 이 화면을 사용하는 입장에서 답하세요.`,
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
    systemInstruction: chatSystemPrompt(persona, frameName),
    contents,
    temperature: 0.8,
  })
}
