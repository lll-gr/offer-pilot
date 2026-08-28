/**
 * 选区填入：全屏覆盖层 + 拖拽框选，返回视口坐标矩形。
 * Esc 取消；过小的选区视为误操作。
 */

import type { SelectionRect } from './scanner/fields'

const SELECTION_OVERLAY_ID = 'offer-pilot-selection-overlay'
const SELECTION_BOX_ID = 'offer-pilot-selection-box'
const SELECTION_HINT_ID = 'offer-pilot-selection-hint'
const MIN_SELECTION_SIZE = 12

interface SelectionPoint {
  x: number
  y: number
}

function cleanupSelectionOverlay(): void {
  document.getElementById(SELECTION_OVERLAY_ID)?.remove()
}

function normalizeSelectionRect(startPoint: SelectionPoint | null, endPoint: SelectionPoint | null): SelectionRect | null {
  if (!startPoint || !endPoint) return null
  const left = Math.min(startPoint.x, endPoint.x)
  const top = Math.min(startPoint.y, endPoint.y)
  const right = Math.max(startPoint.x, endPoint.x)
  const bottom = Math.max(startPoint.y, endPoint.y)

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function updateSelectionBox(box: HTMLElement, startPoint: SelectionPoint, endPoint: SelectionPoint): void {
  const rect = normalizeSelectionRect(startPoint, endPoint)
  if (!rect) return

  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

/** 请求用户拖拽框选；取消或选区过小时返回 null */
export function requestSelectionRect(): Promise<SelectionRect | null> {
  cleanupSelectionOverlay()

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = SELECTION_OVERLAY_ID
    overlay.className = 'offer-pilot-selection-overlay'

    const box = document.createElement('div')
    box.id = SELECTION_BOX_ID
    box.className = 'offer-pilot-selection-box'
    box.hidden = true

    const hint = document.createElement('div')
    hint.id = SELECTION_HINT_ID
    hint.className = 'offer-pilot-selection-hint'
    hint.textContent = '拖拽框选要填写的区域，按 Esc 取消'

    overlay.appendChild(box)
    overlay.appendChild(hint)
    document.documentElement.appendChild(overlay)

    let startPoint: SelectionPoint | null = null
    let isDragging = false

    const cleanup = () => {
      window.removeEventListener('keydown', onKeyDown, true)
      overlay.removeEventListener('pointerdown', onPointerDown, true)
      overlay.removeEventListener('pointermove', onPointerMove, true)
      overlay.removeEventListener('pointerup', onPointerUp, true)
      overlay.removeEventListener('pointercancel', onPointerCancel, true)
      overlay.remove()
    }

    const finish = (rect: SelectionRect | null) => {
      cleanup()
      resolve(rect)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      finish(null)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      startPoint = { x: event.clientX, y: event.clientY }
      isDragging = true
      box.hidden = false
      updateSelectionBox(box, startPoint, startPoint)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging || !startPoint) return
      event.preventDefault()
      updateSelectionBox(box, startPoint, { x: event.clientX, y: event.clientY })
    }

    const onPointerCancel = (event: PointerEvent) => {
      event.preventDefault()
      finish(null)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!isDragging || !startPoint) {
        finish(null)
        return
      }

      event.preventDefault()
      const rect = normalizeSelectionRect(startPoint, { x: event.clientX, y: event.clientY })
      isDragging = false
      startPoint = null

      if (!rect || rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
        finish(null)
        return
      }

      finish(rect)
    }

    window.addEventListener('keydown', onKeyDown, true)
    overlay.addEventListener('pointerdown', onPointerDown, true)
    overlay.addEventListener('pointermove', onPointerMove, true)
    overlay.addEventListener('pointerup', onPointerUp, true)
    overlay.addEventListener('pointercancel', onPointerCancel, true)
  })
}

export { cleanupSelectionOverlay, normalizeSelectionRect }
