import { recoveryVerdict } from '../../steps/receiver-validation'
import { useStegoStore } from '../../store/use-stego-store'
import type { JourneyPhase } from './transmission-animation'

export interface Journey {
  phase: JourneyPhase
  noisy: boolean
  channelUnknown: boolean
  failedAtSender: boolean
  senderLabel?: string
}

/**
 * The animation's phase, derived only from real state: what the worker is running, what it produced, and
 * whether the decoder's AES-GCM check succeeded. `transmitting` (Transfer stage) is passed in because the
 * original animation holds it for a minimum time after the channel finishes.
 */
export function useJourney(view: 'encode' | 'transfer' | 'receive', transmitting = false): Journey {
  const s = useStegoStore()
  // on the receiver side only a file delivered from this page's channel has a known channel
  const channelUnknown = view === 'receive' && s.receivedOrigin !== 'transfer-channel' && s.receivedOrigin !== 'transfer-stego'
  const noisy = !channelUnknown && (view === 'receive' ? (s.receivedOrigin === 'transfer-channel' ? s.transmitted?.params.noiseSnrDb : null) : s.channel.noiseSnrDb) != null

  if (view === 'encode') {
    if (s.busy === 'encode') return { phase: 'encoding', noisy, channelUnknown, failedAtSender: false }
    if (s.encodeError) return { phase: 'failed', noisy, channelUnknown, failedAtSender: true }
    return { phase: s.encoded ? 'ready' : 'compose', noisy, channelUnknown, failedAtSender: false }
  }
  if (view === 'transfer') {
    if (transmitting || s.busy === 'channel' || s.busy === 'deliver') return { phase: 'transmitting', noisy, channelUnknown, failedAtSender: false }
    if (s.transmitted || (s.receivedOrigin && s.receivedOrigin !== 'upload')) return { phase: 'delivered', noisy, channelUnknown, failedAtSender: false }
    return { phase: s.encoded ? 'ready' : 'compose', noisy, channelUnknown, failedAtSender: false }
  }
  // receiver side: the sender is whoever made the file — this page may never have seen them
  const senderLabel = s.receivedOrigin === 'upload' || !s.receivedOrigin ? 'unknown sender' : 'stego.wav'
  if (s.busy === 'decode') return { phase: 'decoding', noisy, channelUnknown, failedAtSender: false, senderLabel }
  if (s.decodeError) return { phase: 'failed', noisy, channelUnknown, failedAtSender: false, senderLabel }
  if (s.decoded) {
    const v = recoveryVerdict(s.decoded.text.status, s.decoded.text.content)
    return { phase: v.success ? 'verified' : 'failed', noisy, channelUnknown, failedAtSender: false, senderLabel }
  }
  if (s.receivedFile) return { phase: 'delivered', noisy, channelUnknown, failedAtSender: false, senderLabel }
  return { phase: 'ready', noisy, channelUnknown, failedAtSender: false, senderLabel }
}
