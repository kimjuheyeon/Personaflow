/**
 * 키 없이 제품을 확인할 수 있는 샘플 시나리오.
 *
 * 실제 Gemini 호출 없이, 6개 화면짜리 SaaS 온보딩 흐름을 재생한다.
 * 판정기는 실제와 같은 코드를 그대로 쓴다 — 데모용 가짜 판정을 따로 만들지 않는다.
 * 그래야 여기서 본 것이 실제 테스트에서도 같은 방식으로 나온다.
 *
 * 시나리오는 의도적으로 두 가지 실패를 포함한다.
 *  - 막힘: 레이블 없는 아이콘 버튼을 이해하지 못해 다음 행동을 찾지 못함
 *  - 의미 오해: 버튼을 눌렀지만 그 결과로 다른 화면을 예상함
 */

import type {
  FlowEdge,
  FlowRun,
  FlowTestConfig,
  Frame,
  PersonaConfig,
  WalkEmotion,
} from '@/types'

/* ── 화면 이미지 (외부 파일 없이 SVG로 그린다) ────────────── */

interface MockElement {
  label: string
  kind: 'heading' | 'body' | 'button' | 'field' | 'icon' | 'card'
}

const PALETTE = {
  page: '#ffffff',
  ink: '#1c1c1e',
  muted: '#8e8e93',
  line: '#e5e5ea',
  primary: '#006fdd',
  surface: '#f2f2f7',
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderElement(element: MockElement, y: number): { markup: string; height: number } {
  const label = escapeXml(element.label)
  const font =
    'font-family="-apple-system, BlinkMacSystemFont, Helvetica Neue, sans-serif"'

  switch (element.kind) {
    case 'heading':
      return {
        markup: `<text x="56" y="${y + 34}" ${font} font-size="30" font-weight="700" fill="${PALETTE.ink}">${label}</text>`,
        height: 58,
      }
    case 'body':
      return {
        markup: `<text x="56" y="${y + 20}" ${font} font-size="16" fill="${PALETTE.muted}">${label}</text>`,
        height: 40,
      }
    case 'button':
      return {
        markup: `<rect x="56" y="${y}" rx="10" width="220" height="48" fill="${PALETTE.primary}"/><text x="166" y="${y + 30}" ${font} font-size="16" font-weight="600" fill="#ffffff" text-anchor="middle">${label}</text>`,
        height: 68,
      }
    case 'field':
      return {
        markup: `<rect x="56" y="${y}" rx="10" width="408" height="46" fill="${PALETTE.page}" stroke="${PALETTE.line}" stroke-width="1.5"/><text x="72" y="${y + 29}" ${font} font-size="15" fill="${PALETTE.muted}">${label}</text>`,
        height: 62,
      }
    case 'card':
      return {
        markup: `<rect x="56" y="${y}" rx="12" width="408" height="66" fill="${PALETTE.surface}"/><text x="76" y="${y + 40}" ${font} font-size="16" fill="${PALETTE.ink}">${label}</text>`,
        height: 80,
      }
    case 'icon':
      // 의도적으로 레이블이 없는 아이콘 버튼. 이 화면이 막힘 지점이 된다.
      return {
        markup: `<rect x="56" y="${y}" rx="10" width="48" height="48" fill="${PALETTE.surface}"/><text x="80" y="${y + 33}" ${font} font-size="24" fill="${PALETTE.muted}" text-anchor="middle">${label}</text>`,
        height: 68,
      }
  }
}

function screenSvg(title: string, elements: MockElement[]): string {
  const width = 520
  const height = 720
  let cursor = 108
  const body = elements
    .map((element) => {
      const rendered = renderElement(element, cursor)
      cursor += rendered.height
      return rendered.markup
    })
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${PALETTE.page}"/>
<rect width="${width}" height="64" fill="${PALETTE.surface}"/>
<text x="56" y="40" font-family="-apple-system, BlinkMacSystemFont, Helvetica Neue, sans-serif" font-size="15" font-weight="600" fill="${PALETTE.ink}">${escapeXml(title)}</text>
<line x1="0" y1="64" x2="${width}" y2="64" stroke="${PALETTE.line}" stroke-width="1"/>
${body}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/* ── 화면 정의 ─────────────────────────────────────────────── */

interface ScreenSpec {
  id: string
  name: string
  label: string
  elements: MockElement[]
}

const SCREENS: ScreenSpec[] = [
  {
    id: 'demo-s1',
    name: 'Screen01',
    label: '랜딩',
    elements: [
      { label: '팀을 위한 AI 워크스페이스', kind: 'heading' },
      { label: '문서를 연결하면 답을 찾아주는 에이전트를 만듭니다', kind: 'body' },
      { label: '시작하기', kind: 'button' },
    ],
  },
  {
    id: 'demo-s2',
    name: 'Screen02',
    label: '로그인',
    elements: [
      { label: '로그인', kind: 'heading' },
      { label: '회사 이메일', kind: 'field' },
      { label: '비밀번호', kind: 'field' },
      { label: '로그인', kind: 'button' },
    ],
  },
  {
    id: 'demo-s3',
    name: 'Screen03',
    label: '대시보드 (빈 상태)',
    elements: [
      { label: '내 에이전트', kind: 'heading' },
      { label: '아직 만든 에이전트가 없습니다', kind: 'body' },
      // 레이블도 툴팁도 없는 아이콘 하나. 여기서 막힌다.
      { label: '+', kind: 'icon' },
    ],
  },
  {
    id: 'demo-s4',
    name: 'Screen04',
    label: '에이전트 이름 설정',
    elements: [
      { label: '새 에이전트', kind: 'heading' },
      { label: '에이전트 이름', kind: 'field' },
      { label: '설명 (선택)', kind: 'field' },
      { label: '다음', kind: 'button' },
    ],
  },
  {
    id: 'demo-s5',
    name: 'Screen05',
    label: '모델 선택',
    elements: [
      { label: '사용할 모델', kind: 'heading' },
      { label: '표준 — 일반 문서 검색에 적합', kind: 'card' },
      { label: 'Enterprise — 관리자 승인 필요', kind: 'card' },
      { label: '생성', kind: 'button' },
    ],
  },
  {
    id: 'demo-s6',
    name: 'Screen06',
    label: '생성 완료',
    elements: [
      { label: '에이전트가 준비됐습니다', kind: 'heading' },
      { label: '문서를 연결하면 바로 질문할 수 있습니다', kind: 'body' },
      { label: '문서 연결하기', kind: 'button' },
    ],
  },
]

export function createDemoFrames(): Frame[] {
  return SCREENS.map((screen, index) => ({
    id: screen.id,
    name: screen.name,
    userLabel: screen.label,
    originalName: `${screen.label}.png`,
    flowOrder: index + 1,
    imageUrl: screenSvg(screen.label, screen.elements),
    sourceType: 'image' as const,
  }))
}

/* ── 흐름 정의 (디자이너가 선언한 설계 의도) ────────────────── */

const EDGES: FlowEdge[] = [
  { id: 'demo-e1', fromFrameId: 'demo-s1', toFrameId: 'demo-s2', actionLabel: '시작하기 버튼 클릭' },
  { id: 'demo-e2', fromFrameId: 'demo-s2', toFrameId: 'demo-s3', actionLabel: '로그인 버튼 클릭' },
  {
    id: 'demo-e3',
    fromFrameId: 'demo-s3',
    toFrameId: 'demo-s4',
    actionLabel: '새 에이전트 생성 아이콘 클릭',
  },
  { id: 'demo-e4', fromFrameId: 'demo-s4', toFrameId: 'demo-s5', actionLabel: '다음 버튼 클릭' },
  { id: 'demo-e5', fromFrameId: 'demo-s5', toFrameId: 'demo-s6', actionLabel: '생성 버튼 클릭' },
]

export function createDemoFlowConfig(): FlowTestConfig {
  return {
    mode: 'flow',
    title: '샘플 · 신규 에이전트 생성 흐름',
    scenario:
      '사용자는 사내 문서 검색용 AI 에이전트를 처음으로 만들려고 합니다. AI 도구를 써본 적은 있지만 관리자 기능에는 익숙하지 않습니다.',
    mission: '새 AI 에이전트를 생성하고 사용할 모델을 설정하세요.',
    entryFrameId: 'demo-s1',
    successFrameId: 'demo-s6',
    expectedPathFrameIds: ['demo-s1', 'demo-s2', 'demo-s3', 'demo-s4', 'demo-s5', 'demo-s6'],
    edges: EDGES,
    maxSteps: 8,
  }
}

export function createDemoPersonas(): PersonaConfig[] {
  return [
    {
      id: 'demo-p1',
      name: '박민준',
      role: '비전공 팀 리드',
      digitalLevel: 'beginner',
      goal: '팀 문서를 찾아주는 도구를 직접 만들어본다',
      device: 'desktop',
      context: '처음 써보는 유저',
      avatar: '🧑‍💼',
      isAiGenerated: true,
    },
    {
      id: 'demo-p2',
      name: '김지수',
      role: '프로덕트 디자이너',
      digitalLevel: 'intermediate',
      goal: '도입 전에 설정 흐름이 얼마나 복잡한지 확인한다',
      device: 'desktop',
      context: '기존 도구 대체 검토 중',
      avatar: '🎨',
      isAiGenerated: true,
    },
    {
      id: 'demo-p3',
      name: '이수현',
      role: '데이터 엔지니어',
      digitalLevel: 'expert',
      goal: '모델 옵션과 권한 조건을 빠르게 파악한다',
      device: 'desktop',
      context: '사내 도입 검토 중',
      avatar: '⚙️',
      isAiGenerated: true,
    },
  ]
}

/* ── 행동 기록 ─────────────────────────────────────────────── */

interface StepSpec {
  from: string
  action: string
  observedElement: string
  /** AI가 예상한 도착 화면. 실제 연결과 다르면 판정기가 "의미 오해"로 잡는다. */
  aiExpected?: string
  matched: boolean
  thought: string
  emotion: WalkEmotion
  seconds: number
  friction?: string
  recommendation?: string
}

function buildRun(
  persona: PersonaConfig,
  steps: StepSpec[],
  outcomeFrameId: string,
  successFrameId: string,
  interview: { question: string; answer: string }[]
): FlowRun {
  const events = steps.map((step, index) => {
    const outgoing = EDGES.filter((item) => item.fromFrameId === step.from)
    return {
      id: `demo-event-${persona.id}-${index + 1}`,
      step: index + 1,
      fromFrameId: step.from,
      toFrameId: step.matched ? outgoing[0]?.toFrameId : undefined,
      action: step.action,
      expectation: '이 행동으로 미션에 한 걸음 가까워지기를 기대한다.',
      thought: step.thought,
      emotion: step.emotion,
      estimatedDurationSeconds: step.seconds,
      expectedAction: outgoing.map((item) => item.actionLabel).join(' / ') || undefined,
      transitionMatched: step.matched,
      aiExpectedFrameId: step.aiExpected,
      observedElement: step.observedElement,
      evidence: `화면에서 "${step.observedElement}"을(를) 확인함`,
      confidence: step.matched ? 82 : 44,
      friction: step.friction,
      recommendation: step.recommendation,
    }
  })

  return {
    id: `demo-run-${persona.id}`,
    personaId: persona.id,
    personaName: persona.name,
    outcome: outcomeFrameId === successFrameId ? 'success' : 'failed',
    events,
    interview,
    summary:
      outcomeFrameId === successFrameId
        ? `${persona.name}은(는) ${events.length}단계로 미션을 완료했습니다.`
        : `${persona.name}은(는) 다음 행동을 찾지 못해 미션을 완료하지 못했습니다.`,
  }
}

export function createDemoFlowRuns(personas: PersonaConfig[]): FlowRun[] {
  const [beginner, designer, expert] = personas

  const commonStart: StepSpec[] = [
    {
      from: 'demo-s1',
      action: '"시작하기" 버튼을 누른다',
      observedElement: '시작하기',
      matched: true,
      thought: '무슨 서비스인지는 알겠고, 일단 시작해보면 될 것 같아요.',
      emotion: 'neutral',
      seconds: 6,
    },
    {
      from: 'demo-s2',
      action: '이메일과 비밀번호를 입력하고 "로그인"을 누른다',
      observedElement: '로그인',
      matched: true,
      thought: '평범한 로그인 화면이라 막히는 건 없어요.',
      emotion: 'neutral',
      seconds: 9,
    },
  ]

  return [
    // 초급 — 레이블 없는 아이콘에서 막힌다
    buildRun(
      beginner,
      [
        ...commonStart,
        {
          from: 'demo-s3',
          action: '에이전트를 만들 수 있는 버튼을 찾아보지만 무엇을 눌러야 할지 모르겠다',
          observedElement: '+',
          matched: false,
          thought:
            '"아직 만든 에이전트가 없습니다"라고만 하고, 어떻게 만드는지는 안 알려주네요. 네모 안의 + 표시가 뭔지 모르겠어요.',
          emotion: 'frustrated',
          seconds: 34,
          friction: '빈 상태에서 다음 행동을 안내하는 문구나 레이블이 없음',
          recommendation:
            '빈 상태에 "새 에이전트 만들기" 같은 명시적 버튼을 두고, 아이콘에는 레이블이나 툴팁을 붙이세요.',
        },
      ],
      'demo-s3',
      'demo-s6',
      [
        {
          question: '첫 행동을 왜 선택했나요?',
          answer: '가장 크고 눈에 띄는 버튼이 "시작하기"였어요.',
        },
        {
          question: '가장 망설였던 순간은 언제였나요?',
          answer:
            '에이전트 목록 화면이요. 만들라고는 하는데 만드는 버튼이 어디 있는지 못 찾았어요.',
        },
        {
          question: '이 흐름에서 가장 바꾸고 싶은 점은 무엇인가요?',
          answer: '아이콘만 두지 말고 글씨로 뭘 하는 버튼인지 알려줬으면 좋겠어요.',
        },
      ]
    ),

    // 중급 — 아이콘은 추론해냈지만 "생성" 결과를 잘못 예상한다
    buildRun(
      designer,
      [
        ...commonStart,
        {
          from: 'demo-s3',
          action: '+ 아이콘이 생성 버튼일 거라 추측하고 누른다',
          observedElement: '+',
          matched: true,
          thought: '보통 +는 새로 만들기니까 이거겠죠. 확신은 없지만요.',
          emotion: 'confused',
          seconds: 14,
          friction: '아이콘의 의미를 추측에 의존해야 함',
          recommendation: '아이콘 옆에 텍스트 레이블을 함께 노출하세요.',
        },
        {
          from: 'demo-s4',
          action: '이름을 입력하고 "다음"을 누른다',
          observedElement: '다음',
          matched: true,
          thought: '이름만 넣으면 되는군요. 간단해요.',
          emotion: 'positive',
          seconds: 11,
        },
        {
          from: 'demo-s5',
          action: '모델을 고르고 "생성"을 누른다',
          observedElement: '생성',
          // 실제로는 완료 화면(s6)으로 가지만, 대시보드로 돌아갈 거라 예상했다
          aiExpected: 'demo-s3',
          matched: true,
          thought:
            '"생성"을 누르면 목록으로 돌아가서 만들어진 걸 확인하게 될 것 같아요.',
          emotion: 'neutral',
          seconds: 13,
        },
      ],
      'demo-s6',
      'demo-s6',
      [
        {
          question: '첫 행동을 왜 선택했나요?',
          answer: '랜딩에서 할 수 있는 게 그것뿐이었어요.',
        },
        {
          question: '가장 망설였던 순간은 언제였나요?',
          answer: '+ 아이콘이요. 맞게 누르는 건지 확신이 없었어요.',
        },
        {
          question: '이 흐름에서 가장 바꾸고 싶은 점은 무엇인가요?',
          answer: '"생성" 버튼이 어디로 데려가는지 미리 알 수 있으면 좋겠어요.',
        },
      ]
    ),

    // 고급 — 완주하지만 권한 조건이 화면에 설명되지 않는다
    buildRun(
      expert,
      [
        ...commonStart,
        {
          from: 'demo-s3',
          action: '+ 아이콘을 눌러 생성 화면으로 간다',
          observedElement: '+',
          matched: true,
          thought: '패턴상 +가 생성이죠.',
          emotion: 'neutral',
          seconds: 5,
        },
        {
          from: 'demo-s4',
          action: '이름만 넣고 "다음"을 누른다',
          observedElement: '다음',
          matched: true,
          thought: '설명은 선택이라니 건너뛰죠.',
          emotion: 'neutral',
          seconds: 7,
        },
        {
          from: 'demo-s5',
          action: 'Enterprise를 고르려다 표준을 고르고 "생성"을 누른다',
          observedElement: '생성',
          matched: true,
          thought:
            'Enterprise가 "관리자 승인 필요"라는데, 내가 관리자인지 아닌지 이 화면에선 알 수가 없네요.',
          emotion: 'confused',
          seconds: 21,
          friction: '권한 조건은 적혀 있으나 현재 사용자가 해당되는지 알 수 없음',
          recommendation:
            '선택 불가한 옵션은 비활성 상태와 사유를 함께 표시하세요.',
        },
      ],
      'demo-s6',
      'demo-s6',
      [
        {
          question: '첫 행동을 왜 선택했나요?',
          answer: '진입점이 하나뿐이었습니다.',
        },
        {
          question: '가장 망설였던 순간은 언제였나요?',
          answer: '모델 선택이요. 권한 조건이 나한테 해당되는지 판단할 근거가 없었습니다.',
        },
        {
          question: '이 흐름에서 가장 바꾸고 싶은 점은 무엇인가요?',
          answer: '내 권한으로 쓸 수 있는 옵션인지 화면에서 바로 보이게 해주세요.',
        },
      ]
    ),
  ]
}
