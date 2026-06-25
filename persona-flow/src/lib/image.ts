/**
 * 시안 이미지를 Gemini API 전송용 base64(inlineData)로 변환한다.
 * 토큰 절약을 위해 긴 변을 maxDim으로 축소하고 JPEG로 인코딩한다.
 */

export interface InlineImage {
  mimeType: string
  data: string // base64 (data URL 접두사 제외)
}

function loadImage(src: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let objectUrl: string | null = null

    const cleanup = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }

    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('이미지를 불러오지 못했습니다.'))
    }

    if (typeof src === 'string') {
      img.src = src
    } else {
      objectUrl = URL.createObjectURL(src)
      img.src = objectUrl
    }
  })
}

export async function imageToBase64(
  src: File | string,
  maxDim = 1280,
  quality = 0.85
): Promise<InlineImage> {
  const img = await loadImage(src)

  let { width, height } = img
  const longest = Math.max(width, height)
  if (longest > maxDim) {
    const ratio = maxDim / longest
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 컨텍스트를 만들 수 없습니다.')
  // 투명 PNG 대비 흰 배경
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const commaIdx = dataUrl.indexOf(',')
  const data = dataUrl.slice(commaIdx + 1)

  return { mimeType: 'image/jpeg', data }
}
