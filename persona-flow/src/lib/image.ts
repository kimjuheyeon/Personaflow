/**
 * 시안 이미지를 AI 전송용 base64(inlineData)로 변환한다.
 * 전체 구도는 축소본으로, 작은 카피와 조작 요소는 겹치는 상세 구간으로 보존한다.
 */

export interface InlineImage {
  mimeType: string
  data: string // base64 (data URL 접두사 제외)
}

export interface VisionImage extends InlineImage {
  kind: 'overview' | 'detail'
  label: string
  sourceWidth: number
  sourceHeight: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
}

export interface VisionImageOptions {
  includeDetails?: boolean
  maxDetailImages?: number
  overviewMaxDim?: number
  detailMaxDim?: number
  overlapRatio?: number
}

function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//i.test(src)
}

async function resolveImageSource(src: File | string): Promise<{ src: string; revoke?: () => void }> {
  if (typeof src !== 'string') {
    const objectUrl = URL.createObjectURL(src)
    return {
      src: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    }
  }

  if (!isRemoteUrl(src)) return { src }

  let response: Response
  try {
    response = await fetch(src)
  } catch {
    throw new Error('원격 이미지를 불러오지 못했습니다.')
  }

  if (!response.ok) {
    throw new Error(`원격 이미지 요청 실패 (HTTP ${response.status})`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  return {
    src: objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
  }
}

async function loadImage(src: File | string): Promise<HTMLImageElement> {
  const resolved = await resolveImageSource(src)
  return new Promise((resolve, reject) => {
    const img = new Image()

    const cleanup = () => {
      resolved.revoke?.()
    }

    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('이미지를 불러오지 못했습니다.'))
    }

    img.src = resolved.src
  })
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/jpeg' | 'image/webp',
  quality: number
): InlineImage {
  const dataUrl = canvas.toDataURL(mimeType, quality)
  const commaIndex = dataUrl.indexOf(',')
  const actualMimeType = dataUrl.slice(5, dataUrl.indexOf(';')) || mimeType
  return {
    mimeType: actualMimeType,
    data: dataUrl.slice(commaIndex + 1),
  }
}

function renderCrop(
  image: HTMLImageElement,
  crop: CropRect,
  maxDim: number,
  mimeType: 'image/jpeg' | 'image/webp',
  quality: number
): InlineImage {
  const ratio = Math.min(1, maxDim / Math.max(crop.width, crop.height))
  const width = Math.max(1, Math.round(crop.width * ratio))
  const height = Math.max(1, Math.round(crop.height * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 컨텍스트를 만들 수 없습니다.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height
  )
  return encodeCanvas(canvas, mimeType, quality)
}

function detailCrops(
  width: number,
  height: number,
  maxDetailImages: number,
  overlapRatio: number
): CropRect[] {
  const isVertical = height >= width
  const longSide = isVertical ? height : width
  const shortSide = isVertical ? width : height
  const safeMax = Math.max(1, Math.floor(maxDetailImages))
  const safeOverlap = Math.min(0.3, Math.max(0, overlapRatio))

  // 2배율 Figma export 기준으로 한 구간이 실제 화면 폭과 비슷하게 유지되도록 한다.
  let span = Math.min(longSide, shortSide * 1.15)
  const naturalStep = Math.max(1, span * (1 - safeOverlap))
  const naturalCount = Math.max(1, Math.ceil((longSide - span) / naturalStep) + 1)

  // 아주 긴 화면도 누락 구간이 생기지 않게, 제한 개수를 넘으면 구간 자체를 늘린다.
  const count = Math.min(safeMax, naturalCount)
  if (naturalCount > safeMax) {
    span = Math.min(
      longSide,
      longSide / Math.max(1, count - safeOverlap * Math.max(0, count - 1))
    )
  }

  if (count === 1) {
    return [{ x: 0, y: 0, width, height }]
  }

  const lastStart = Math.max(0, longSide - span)
  return Array.from({ length: count }, (_, index) => {
    const start = Math.round((lastStart * index) / (count - 1))
    return isVertical
      ? { x: 0, y: start, width, height: Math.round(span) }
      : { x: start, y: 0, width: Math.round(span), height }
  })
}

export async function imageToVisionImages(
  src: File | string,
  options: VisionImageOptions = {}
): Promise<VisionImage[]> {
  const image = await loadImage(src)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const overviewMaxDim = options.overviewMaxDim ?? 1600
  const detailMaxDim = options.detailMaxDim ?? 1800
  const includeDetails = options.includeDetails ?? true
  const maxDetailImages = options.maxDetailImages ?? 6
  const overlapRatio = options.overlapRatio ?? 0.12
  const fullCrop = { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  const overview = renderCrop(image, fullCrop, overviewMaxDim, 'image/webp', 0.9)
  const images: VisionImage[] = [
    {
      ...overview,
      kind: 'overview',
      label: `전체 화면 축소본 (${sourceWidth}×${sourceHeight})`,
      sourceWidth,
      sourceHeight,
      cropX: 0,
      cropY: 0,
      cropWidth: sourceWidth,
      cropHeight: sourceHeight,
    },
  ]

  const longest = Math.max(sourceWidth, sourceHeight)
  const shortest = Math.max(1, Math.min(sourceWidth, sourceHeight))
  const needsDetails = includeDetails && (longest > overviewMaxDim || longest / shortest > 1.6)
  if (!needsDetails) return images

  const crops = detailCrops(sourceWidth, sourceHeight, maxDetailImages, overlapRatio)
  for (let index = 0; index < crops.length; index++) {
    const crop = crops[index]
    const encoded = renderCrop(image, crop, detailMaxDim, 'image/webp', 0.94)
    const start = sourceHeight >= sourceWidth ? crop.y : crop.x
    const end = start + (sourceHeight >= sourceWidth ? crop.height : crop.width)
    images.push({
      ...encoded,
      kind: 'detail',
      label: `상세 구간 ${index + 1}/${crops.length} (원본 ${Math.round(start)}~${Math.round(end)}px)`,
      sourceWidth,
      sourceHeight,
      cropX: crop.x,
      cropY: crop.y,
      cropWidth: crop.width,
      cropHeight: crop.height,
    })
  }

  return images
}

export async function imageToBase64(
  src: File | string,
  maxDim = 1280,
  quality = 0.85
): Promise<InlineImage> {
  const image = await loadImage(src)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return renderCrop(
    image,
    { x: 0, y: 0, width, height },
    maxDim,
    'image/jpeg',
    quality
  )
}
