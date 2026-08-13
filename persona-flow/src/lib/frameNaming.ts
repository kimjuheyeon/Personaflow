import type { Frame } from '@/types'

type FrameLabel = Pick<Frame, 'name' | 'originalName' | 'userLabel'>

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

export function formatScreenName(index: number): string {
  return `Screen${String(index + 1).padStart(2, '0')}`
}

export function normalizeFrameOrder(frames: Frame[]): Frame[] {
  return frames.map((frame, index) => ({
    ...frame,
    name: formatScreenName(index),
    originalName:
      frame.originalName ?? (frame.file ? stripFileExtension(frame.file.name) : undefined),
    flowOrder: index + 1,
  }))
}

export function getFrameSecondaryLabel(
  frame: Pick<FrameLabel, 'originalName' | 'userLabel'>
): string {
  const userLabel = frame.userLabel?.trim()
  if (userLabel) return userLabel
  return frame.originalName?.trim() ?? ''
}

export function getFrameDisplayName(frame: FrameLabel): string {
  const primary = frame.name.trim()
  const secondary = getFrameSecondaryLabel(frame)
  const isDuplicate =
    secondary.localeCompare(primary, undefined, { sensitivity: 'base' }) === 0

  return secondary && !isDuplicate ? `${primary} · ${secondary}` : primary
}

export function getFrameProjectLabel(frame: FrameLabel): string {
  return getFrameSecondaryLabel(frame) || frame.name
}
