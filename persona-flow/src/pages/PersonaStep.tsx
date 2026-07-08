import { useState } from 'react'
import { Loader2, Plus, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { suggestDemoPersonas } from '@/lib/ai/demo'
import { suggestPersonas } from '@/lib/ai/gemini'
import type { AIMode, PersonaConfig, DigitalLevel, DeviceType, Frame, SourceType } from '@/types'

interface PersonaStepProps {
  personas: PersonaConfig[]
  onPersonasChange: (personas: PersonaConfig[]) => void
  onNext: () => void
  onBack: () => void
  frames: Frame[]
  sourceType: SourceType
  aiMode: AIMode
  apiKey: string
  model: string
  onRequireKey: () => void
}

const DIGITAL_LABEL: Record<DigitalLevel, string> = {
  beginner: '초급',
  intermediate: '중급',
  expert: '고급',
}

const DIGITAL_BADGE_CLASS: Record<DigitalLevel, string> = {
  beginner: 'bg-gray-100 text-gray-600',
  intermediate: 'bg-blue-100 text-blue-700',
  expert: 'bg-green-100 text-green-700',
}

const DEVICE_LABEL: Record<DeviceType, string> = {
  desktop: '데스크탑',
  mobile: '모바일',
  tablet: '태블릿',
}

const EMPTY_FORM = {
  name: '',
  role: '',
  digitalLevel: 'intermediate' as DigitalLevel,
  goal: '',
  device: 'desktop' as DeviceType,
  context: '처음 써보는 유저',
}

function hasFrameImage(frame: Frame): boolean {
  return Boolean(frame.file || frame.imageUrl)
}

export default function PersonaStep({
  personas,
  onPersonasChange,
  onNext,
  onBack,
  frames,
  sourceType,
  aiMode,
  apiKey,
  model,
  onRequireKey,
}: PersonaStepProps) {
  const initialDemoPersonas = suggestDemoPersonas(sourceType)
  const [activeTab, setActiveTab] = useState<'ai' | 'manual'>('ai')
  const [aiPersonas, setAiPersonas] = useState<PersonaConfig[]>(
    aiMode === 'demo' ? initialDemoPersonas : []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set((aiMode === 'demo' ? initialDemoPersonas : []).map((p) => p.id))
  )
  const [form, setForm] = useState(EMPTY_FORM)

  const handleAiRecommend = async () => {
    if (aiMode === 'demo') {
      const list = suggestDemoPersonas(sourceType)
      setAiPersonas(list)
      setSelectedIds(new Set(list.map((p) => p.id)))
      setError(null)
      return
    }

    if (!apiKey) {
      onRequireKey()
      return
    }
    if (frames.length === 0) {
      setError('먼저 테스트할 화면을 연결하거나 업로드해주세요.')
      return
    }
    if (!frames.some(hasFrameImage)) {
      setError(
        '실제 AI 페르소나 추천에는 화면 이미지가 필요합니다. Figma 개인 액세스 토큰으로 화면 이미지를 가져오거나 PNG/JPG 이미지를 업로드해주세요.'
      )
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await suggestPersonas(apiKey, model, frames)
      setAiPersonas(list)
      // 추천 결과는 기본 전체 선택
      setSelectedIds(new Set(list.map((p) => p.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 추천에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddManual = () => {
    if (!form.name.trim() || !form.role.trim()) return
    const newPersona: PersonaConfig = {
      id: `manual-${Date.now()}`,
      ...form,
    }
    onPersonasChange([...personas, newPersona])
    setForm(EMPTY_FORM)
  }

  const handleDeletePersona = (id: string) => {
    onPersonasChange(personas.filter((p) => p.id !== id))
  }

  const syncAiSelected = () => {
    const selected = aiPersonas.filter((p) => selectedIds.has(p.id))
    const manualOnly = personas.filter((p) => !p.isAiGenerated)
    onPersonasChange([...selected, ...manualOnly])
  }

  const handleTabChange = (tab: 'ai' | 'manual') => {
    if (activeTab === 'ai') syncAiSelected()
    setActiveTab(tab)
  }

  const handleNext = () => {
    if (activeTab === 'ai') {
      const selected = aiPersonas.filter((p) => selectedIds.has(p.id))
      const manualOnly = personas.filter((p) => !p.isAiGenerated)
      onPersonasChange([...selected, ...manualOnly])
    }
    onNext()
  }

  const selectedAiCount = aiPersonas.filter((persona) => selectedIds.has(persona.id)).length
  const totalSelected =
    activeTab === 'ai'
      ? selectedAiCount + personas.filter((p) => !p.isAiGenerated).length
      : personas.length

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">페르소나 설정</h2>
        <p className="text-xs text-gray-500 mt-0.5">테스트할 사용자 유형을 설정하세요.</p>
      </div>

      {/* 언더라인 탭 */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {(['ai', 'manual'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab === 'ai' ? 'AI 추천' : '직접 설정'}
            </button>
          ))}
        </div>
      </div>

      {/* AI 추천 탭 */}
      {activeTab === 'ai' && (
        <div className="space-y-3">
          {aiPersonas.length === 0 && !loading && (
            <div className="py-12 border border-gray-200 rounded-md bg-white text-center space-y-3">
              <p className="text-sm text-gray-600 font-medium">AI가 최적의 페르소나를 추천합니다</p>
              <p className="text-xs text-gray-400">
                {aiMode === 'demo'
                  ? '샘플 테스트용 페르소나가 자동으로 준비됩니다'
                  : '가져온 화면 이미지를 Gemini가 보고 사용자 유형을 제안합니다'}
              </p>
              {error && (
                <p className="text-xs text-red-600 max-w-md mx-auto leading-relaxed px-4">{error}</p>
              )}
              <Button onClick={handleAiRecommend} size="sm">
                {aiMode === 'demo' ? '샘플 페르소나 다시 준비' : 'AI 페르소나 추천받기'}
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 border border-gray-200 rounded-md bg-white">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">시안을 분석해 페르소나를 생성하는 중...</p>
            </div>
          )}

          {!loading && aiPersonas.length > 0 && (
            <div className="space-y-2">
              {error && (
                <p className="text-xs text-red-600 leading-relaxed">{error}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">{selectedIds.size}개 선택 · 클릭하여 선택/해제</p>
                <button
                  onClick={handleAiRecommend}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {aiMode === 'demo' ? '샘플 페르소나 다시 준비' : '다시 추천받기'}
                </button>
              </div>

              {/* 테이블형 카드 */}
              <div className="border border-gray-200 rounded-md overflow-hidden">
                {aiPersonas.map((persona, idx) => {
                  const isSelected = selectedIds.has(persona.id)
                  return (
                    <div
                      key={persona.id}
                      onClick={() => toggleSelect(persona.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                        idx !== 0 ? 'border-t border-gray-100' : ''
                      } ${isSelected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                    >
                      {/* 체크박스 */}
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>

                      {/* 이름 + 역할 */}
                      <div className="w-36 flex-shrink-0">
                        <span className="text-sm font-medium text-gray-900">{persona.name}</span>
                        <span className="text-xs text-gray-500 block">{persona.role}</span>
                      </div>

                      {/* 디지털 레벨 */}
                      <div className="w-16 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIGITAL_BADGE_CLASS[persona.digitalLevel]}`}>
                          {DIGITAL_LABEL[persona.digitalLevel]}
                        </span>
                      </div>

                      {/* 기기 */}
                      <div className="w-20 flex-shrink-0 text-xs text-gray-500">
                        {DEVICE_LABEL[persona.device]}
                      </div>

                      {/* 목표 */}
                      <div className="flex-1 text-xs text-gray-600 truncate">
                        {persona.goal}
                      </div>

                      {/* AI 배지 */}
                      {persona.isAiGenerated && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium flex-shrink-0">
                          AI
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 직접 설정 탭 */}
      {activeTab === 'manual' && (
        <div className="space-y-4">
          {/* 폼 */}
          <div className="border border-gray-200 rounded-md bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">새 페르소나 추가</h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">이름</Label>
                <Input
                  placeholder="예: 김지수"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">직무 / 역할</Label>
                <Input
                  placeholder="예: UX 디자이너"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">디지털 친숙도</Label>
                <Select
                  value={form.digitalLevel}
                  onValueChange={(v) => setForm({ ...form, digitalLevel: v as DigitalLevel })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">초급</SelectItem>
                    <SelectItem value="intermediate">중급</SelectItem>
                    <SelectItem value="expert">고급</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">기기 환경</Label>
                <Select
                  value={form.device}
                  onValueChange={(v) => setForm({ ...form, device: v as DeviceType })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desktop">데스크탑</SelectItem>
                    <SelectItem value="mobile">모바일</SelectItem>
                    <SelectItem value="tablet">태블릿</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">사용 목적</Label>
              <Input
                placeholder="예: 새로운 협업 도구 도입 검토"
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">사용 맥락</Label>
              <Select
                value={form.context}
                onValueChange={(v) => setForm({ ...form, context: v })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="처음 써보는 유저">처음 써보는 유저</SelectItem>
                  <SelectItem value="기존 도구 대체 검토 중">기존 도구 대체 검토 중</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleAddManual}
              disabled={!form.name.trim() || !form.role.trim()}
              size="sm"
              variant="outline"
              className="w-full"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              페르소나 추가
            </Button>
          </div>

          {/* 추가된 페르소나 목록 */}
          {personas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-700">
                추가된 페르소나 ({personas.length}개)
              </h3>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                {personas.map((persona, idx) => (
                  <div
                    key={persona.id}
                    className={`flex items-center gap-3 px-4 py-2.5 bg-white ${
                      idx !== 0 ? 'border-t border-gray-100' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{persona.name}</span>
                        <span className="text-xs text-gray-500">{persona.role}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIGITAL_BADGE_CLASS[persona.digitalLevel]}`}>
                          {DIGITAL_LABEL[persona.digitalLevel]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {DEVICE_LABEL[persona.device]} · {persona.context}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeletePersona(persona.id)}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 하단 버튼 */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={onBack}>
          이전
        </Button>
        <div className="flex items-center gap-3">
          {totalSelected > 0 && (
            <span className="text-xs text-gray-500">{totalSelected}개 선택됨</span>
          )}
          <Button size="sm" onClick={handleNext} disabled={totalSelected === 0}>
            AI 테스트 시작
          </Button>
        </div>
      </div>
    </div>
  )
}
