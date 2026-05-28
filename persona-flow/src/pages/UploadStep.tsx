import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, ImageIcon, X, Pencil, Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Frame } from '@/types'

interface UploadStepProps {
  frames: Frame[]
  onFramesChange: (frames: Frame[]) => void
  onNext: () => void
}

export default function UploadStep({ frames, onFramesChange, onNext }: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMoreInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const validFiles = Array.from(files).filter((f) =>
        ['image/png', 'image/jpeg', 'image/jpg'].includes(f.type)
      )
      const newFrames: Frame[] = validFiles.map((file) => {
        const url = URL.createObjectURL(file)
        objectUrlsRef.current.push(url)
        return {
          id: `frame-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          imageUrl: url,
          file,
        }
      })
      onFramesChange([...frames, ...newFrames])
    },
    [frames, onFramesChange]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      processFiles(e.dataTransfer.files)
    },
    [processFiles]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }

  const handleDelete = (id: string) => {
    const frame = frames.find((f) => f.id === id)
    if (frame) {
      URL.revokeObjectURL(frame.imageUrl)
      objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== frame.imageUrl)
    }
    onFramesChange(frames.filter((f) => f.id !== id))
  }

  const startEdit = (frame: Frame) => {
    setEditingId(frame.id)
    setEditingName(frame.name)
  }

  const commitEdit = (id: string) => {
    onFramesChange(
      frames.map((f) => (f.id === id ? { ...f, name: editingName.trim() || f.name } : f))
    )
    setEditingId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') commitEdit(id)
    if (e.key === 'Escape') setEditingId(null)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">시안 업로드</h2>
        <p className="text-xs text-gray-500 mt-0.5">테스트할 UI 화면 이미지를 업로드하세요. PNG, JPG 지원.</p>
      </div>

      {frames.length === 0 ? (
        <div
          className={`
            border border-dashed rounded-md transition-colors cursor-pointer
            flex flex-col items-center justify-center gap-3 py-16
            ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'}
          `}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-7 h-7 text-gray-400" />
          <div className="text-center">
            <p className="text-sm text-gray-600 font-medium">이미지를 드래그하거나 클릭하여 업로드</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG · 최대 10MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* 프레임 그리드 */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {frames.map((frame) => (
              <div
                key={frame.id}
                className="bg-white rounded-md border border-gray-200 overflow-hidden group"
              >
                <div className="aspect-video bg-gray-100 relative overflow-hidden">
                  {frame.imageUrl ? (
                    <img
                      src={frame.imageUrl}
                      alt={frame.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(frame.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                <div className="px-2 py-1.5">
                  {editingId === frame.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, frame.id)}
                        onBlur={() => commitEdit(frame.id)}
                        className="h-6 text-xs px-1.5"
                        autoFocus
                      />
                      <button
                        onClick={() => commitEdit(frame.id)}
                        className="w-5 h-5 flex items-center justify-center text-blue-500 hover:text-blue-600 flex-shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group/name">
                      <span className="text-xs text-gray-700 truncate flex-1 leading-tight">{frame.name}</span>
                      <button
                        onClick={() => startEdit(frame)}
                        className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 opacity-0 group-hover/name:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 추가 버튼 */}
          <div
            className={`
              border border-dashed rounded-md transition-colors cursor-pointer
              flex items-center justify-center gap-2 py-4
              ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => addMoreInputRef.current?.click()}
          >
            <Plus className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-500">프레임 추가</span>
            <input
              ref={addMoreInputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <p className="text-xs text-gray-400">
            {frames.length}개 프레임 업로드됨
          </p>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button
          onClick={onNext}
          disabled={frames.length === 0}
          size="sm"
          className="px-6"
        >
          다음 단계 →
        </Button>
      </div>
    </div>
  )
}
