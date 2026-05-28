interface DashboardProps {
  onNewTest: () => void
}

const features = [
  {
    icon: '⚡',
    title: '수 분 내 결과',
    description: '실제 유저 섭외 없이 즉시 실행',
  },
  {
    icon: '🎭',
    title: '다각도 페르소나',
    description: '직접 설정 또는 AI 자동 추천',
  },
  {
    icon: '📊',
    title: 'SaaS 보편 6축 평가',
    description: '어떤 제품에도 적용 가능한 표준 기준',
  },
]

const flowSteps = [
  {
    number: '1',
    icon: '🖼️',
    title: '시안 입력',
    description: 'UI 이미지를 업로드',
  },
  {
    number: '2',
    icon: '🎭',
    title: '페르소나 설정',
    description: 'AI 추천 또는 직접 설정',
  },
  {
    number: '3',
    icon: '🤖',
    title: 'AI 테스트 실행',
    description: '자동 분석 및 평가',
  },
  {
    number: '4',
    icon: '📋',
    title: '리포트 출력',
    description: '구조화된 UX 인사이트',
  },
]

const severities = [
  {
    dot: '🔴',
    level: 'Critical',
    color: 'text-red-600',
    bg: 'bg-red-50 border-red-200',
    description: '태스크 완료 자체가 불가능한 문제, 즉각 수정 필요',
  },
  {
    dot: '🟡',
    level: 'Warning',
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    description: '완료는 되지만 마찰이 존재하는 문제, 개선 권고',
  },
  {
    dot: '🔵',
    level: 'Suggestion',
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    description: '경험을 향상시킬 수 있는 기회, 선택적 개선',
  },
]

const comparisonRows = [
  {
    category: '유저 섭외',
    traditional: '실제 유저 필요',
    personaflow: 'AI 페르소나 즉시',
  },
  {
    category: '소요 시간',
    traditional: '수 일 ~ 수 주',
    personaflow: '수 분 내',
  },
  {
    category: '비용',
    traditional: '고가 (인건비)',
    personaflow: '저비용',
  },
  {
    category: '시안 적용',
    traditional: '어려움',
    personaflow: '이미지만으로 가능',
  },
]

export default function Dashboard({ onNewTest }: DashboardProps) {
  return (
    <div className="min-h-screen bg-white">
      {/* 네비게이션 */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧪</span>
            <span className="text-xl font-bold text-gray-900">PersonaFlow</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              로그인
            </button>
            <button
              onClick={onNewTest}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              무료로 시작하기
            </button>
          </div>
        </div>
      </nav>

      {/* 히어로 섹션 */}
      <section className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
            시안 단계에서 바로 유저테스트를
          </h1>
          <p className="text-lg sm:text-xl text-blue-100 max-w-2xl mx-auto leading-relaxed">
            AI 페르소나가 실제 유저처럼 탐색하고, 수 분 내에 구조화된 UX 리포트를 자동 생성합니다
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <button
              onClick={onNewTest}
              className="px-8 py-3.5 text-base font-semibold text-blue-700 bg-white hover:bg-blue-50 rounded-xl shadow-lg transition-colors"
            >
              무료로 테스트 시작하기
            </button>
            <button className="px-8 py-3.5 text-base font-semibold text-white border-2 border-white/40 hover:border-white/70 rounded-xl transition-colors">
              데모 보기
            </button>
          </div>
        </div>
      </section>

      {/* 주요 특징 */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            왜 PersonaFlow인가요?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-white rounded-2xl p-7 shadow-sm border border-gray-100 text-center space-y-3"
              >
                <div className="text-4xl">{feature.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 서비스 플로우 */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            4단계로 완성되는 UX 테스트
          </h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-center gap-0">
            {flowSteps.map((step, index) => (
              <div key={step.number} className="flex flex-col sm:flex-row items-center">
                {/* 단계 카드 */}
                <div className="flex flex-col items-center text-center w-44 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-2xl">
                    {step.icon}
                  </div>
                  <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
                    {step.number}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{step.title}</p>
                    <p className="text-gray-500 text-xs mt-1">{step.description}</p>
                  </div>
                </div>
                {/* 화살표 */}
                {index < flowSteps.length - 1 && (
                  <div className="text-gray-300 text-2xl font-light px-2 my-4 sm:my-0 rotate-90 sm:rotate-0">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 심각도 분류 */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
            구조화된 심각도 분류
          </h2>
          <p className="text-gray-500 text-center mb-12">
            발견된 UX 문제를 3단계 심각도로 분류해 우선순위를 명확히 합니다
          </p>
          <div className="space-y-4">
            {severities.map((item) => (
              <div
                key={item.level}
                className={`rounded-xl border p-5 flex items-start gap-4 ${item.bg}`}
              >
                <span className="text-2xl flex-shrink-0 mt-0.5">{item.dot}</span>
                <div>
                  <span className={`font-semibold text-base ${item.color}`}>{item.level}</span>
                  <p className="text-gray-600 text-sm mt-1">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 비교 테이블 */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            기존 UT vs PersonaFlow
          </h2>
          <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            {/* 헤더 */}
            <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
              <div className="p-4 text-sm font-semibold text-gray-500"></div>
              <div className="p-4 text-sm font-semibold text-gray-600 text-center border-l border-gray-200">
                기존 유저 테스트
              </div>
              <div className="p-4 text-sm font-semibold text-blue-700 text-center border-l border-gray-200 bg-blue-50">
                PersonaFlow
              </div>
            </div>
            {/* 행 */}
            {comparisonRows.map((row, index) => (
              <div
                key={row.category}
                className={`grid grid-cols-3 ${index < comparisonRows.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <div className="p-4 text-sm font-medium text-gray-700 bg-gray-50">{row.category}</div>
                <div className="p-4 text-sm text-gray-500 text-center border-l border-gray-100">
                  {row.traditional}
                </div>
                <div className="p-4 text-sm font-medium text-blue-700 text-center border-l border-gray-100 bg-blue-50/50">
                  ✓ {row.personaflow}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 하단 CTA */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-3xl font-bold">지금 바로 시작해보세요</h2>
          <p className="text-blue-100 text-lg">
            시안만 있으면 됩니다. 수 분 내에 전문적인 UX 리포트를 받아보세요.
          </p>
          <button
            onClick={onNewTest}
            className="px-10 py-4 text-base font-semibold text-blue-700 bg-white hover:bg-blue-50 rounded-xl shadow-lg transition-colors"
          >
            무료로 테스트 시작하기
          </button>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="py-8 px-6 bg-gray-900 text-center">
        <p className="text-gray-400 text-sm">
          © 2026 PersonaFlow · AI 기반 자동 유저테스트 플랫폼
        </p>
      </footer>
    </div>
  )
}
