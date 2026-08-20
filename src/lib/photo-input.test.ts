import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../vitest.intl'
import {
  base64ToBytes,
  bytesToBase64,
  isPhotoPose,
  isValidThumbHash,
  PHOTO_POSES,
  photoPoseLabel,
  sniffImageContentType,
} from './photo-input'

describe('pose whitelist', () => {
  it('accepts the three known poses and rejects others', () => {
    expect(isPhotoPose('front')).toBe(true)
    expect(isPhotoPose('side')).toBe(true)
    expect(isPhotoPose('back')).toBe(true)
    expect(isPhotoPose('forward')).toBe(false)
    expect(isPhotoPose('')).toBe(false)
  })

  // The label is a DESCRIPTOR: title-casing the stored enum only ever
  // produced English, and the value itself is a db fact that must never be
  // written in the creating user's language.
  it('names the catalog key for each pose rather than title-casing the value', () => {
    expect(photoPoseLabel('front')).toEqual({ key: 'pose.front' })
    expect(photoPoseLabel('side')).toEqual({ key: 'pose.side' })
    expect(photoPoseLabel('back')).toEqual({ key: 'pose.back' })
  })

  it('resolves every pose key against the real catalog', () => {
    for (const pose of PHOTO_POSES) {
      const label = renderMessageIn('Body', photoPoseLabel(pose))
      expect(label).not.toMatch(/Body\.[a-zA-Z.]+/)
      expect(label.length).toBeGreaterThan(0)
    }
    expect(renderMessageIn('Body', photoPoseLabel('front'))).toBe('Front')
  })
})

describe('base64 round-trip', () => {
  it('encodes and decodes bytes losslessly', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('isValidThumbHash', () => {
  it('accepts a plausibly-sized hash', () => {
    // A real ThumbHash is ~25 bytes.
    expect(isValidThumbHash(bytesToBase64(new Uint8Array(25)))).toBe(true)
  })

  it('rejects a too-short hash', () => {
    expect(isValidThumbHash(bytesToBase64(new Uint8Array(2)))).toBe(false)
  })

  it('rejects an oversized hash', () => {
    expect(isValidThumbHash(bytesToBase64(new Uint8Array(128)))).toBe(false)
  })

  it('rejects non-base64 garbage', () => {
    expect(isValidThumbHash('!!!not base64!!!')).toBe(false)
  })
})

describe('sniffImageContentType (magic bytes, not extension)', () => {
  const pad = (head: number[]): Uint8Array => {
    const bytes = new Uint8Array(16)
    bytes.set(head)
    return bytes
  }
  const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

  it('identifies WEBP by RIFF....WEBP', () => {
    const bytes = pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])
    expect(sniffImageContentType(bytes)).toBe('image/webp')
  })

  it('identifies JPEG by FF D8 FF', () => {
    expect(sniffImageContentType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })

  it('identifies PNG by its 8-byte signature', () => {
    expect(
      sniffImageContentType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png')
  })

  it('identifies HEIC by an ftyp brand', () => {
    const bytes = pad([0, 0, 0, 0, ...ascii('ftyp'), ...ascii('heic')])
    expect(sniffImageContentType(bytes)).toBe('image/heic')
  })

  it('returns null for a non-image (e.g. an HTML/script payload renamed .webp)', () => {
    const bytes = pad(ascii('<html><script'))
    expect(sniffImageContentType(bytes)).toBeNull()
  })

  it('returns null for a truncated header', () => {
    expect(sniffImageContentType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})
