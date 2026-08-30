import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './push-client'

describe('urlBase64ToUint8Array', () => {
  it('decodes plain base64url to the raw bytes', () => {
    // Arrange: 'AQID' is base64 for bytes 1,2,3
    const result = urlBase64ToUint8Array('AQID')

    // Assert
    expect(Array.from(result)).toEqual([1, 2, 3])
  })

  it('maps url-safe characters (-, _) to their base64 originals (+, /)', () => {
    // '-_8' is base64url for '+/8' = bytes 0xfb, 0xff
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([0xfb, 0xff])
  })

  it('restores stripped padding', () => {
    // 'AQ' (one byte, padding stripped) must decode as 'AQ=='
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1])
  })
})
