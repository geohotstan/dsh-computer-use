/** Pure presenter contracts: the empty app list and the attachment-reference projection. */

import { describe, expect, it } from 'vitest'
import { imageRefFromValue, listAppsText } from '../../src/computer-tools/render.ts'

describe('listAppsText', () => {
  it('reports an empty list explicitly', () => {
    expect(listAppsText([])).toBe('No targetable apps found.')
  })
})

describe('imageRefFromValue', () => {
  it('projects a screenshot with a name', () => {
    const ref = imageRefFromValue({
      attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 12, width: 1, height: 1, name: 'a-window.jpg',
    })
    expect(ref).toEqual({ attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 12, width: 1, height: 1, name: 'a-window.jpg' })
  })

  it('projects a screenshot without a name', () => {
    const ref = imageRefFromValue({
      attachmentId: 'att-2', mediaType: 'image/jpeg', bytes: 12, width: 1, height: 1,
    })
    expect(ref).toEqual({ attachmentId: 'att-2', mediaType: 'image/jpeg', bytes: 12, width: 1, height: 1 })
  })
})
