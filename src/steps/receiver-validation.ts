/**
 * Preflight for the Receiver step.
 *
 * The receiver only ever has a file and a key, so these checks use nothing from the sender's state.
 * They mirror what `decode()` in dsp/stego.ts enforces, and nothing more: whether a file actually
 * carries a hidden message cannot be told from its spectrum. A real stego file has *less* energy in
 * the 16.5-19.9 kHz carrier band than an ordinary recording (the encoder band-stops the cover there
 * before adding a quiet hidden signal), and the gap between a valid file and one whose top band was
 * stripped by MP3 is only ~19 dB - well inside the range real material spans. Only the decode can
 * answer that, so the verdict below reports what it actually proved.
 */
import type { AudioClip } from '../audio/load-audio'
import type { FrameContent } from '../dsp/bit-lane'
import { peak } from '../dsp/analysis'
import { MAX_DURATION_S, SAMPLE_RATE } from '../dsp/constants'
import { computeLayout } from '../dsp/spectral-ops'
import { fftSizeFor } from '../dsp/stego'

export interface ReceivedAudioCheck {
  /** Set when the file cannot be decoded at all — the key step stays locked. */
  error: string | null
  /** Set when the file decodes but something is worth saying before recovery. */
  warning: string | null
}

/** Everything that can honestly be judged about a received file before a key is involved. */
export function checkReceivedAudio(clip: AudioClip | null): ReceivedAudioCheck {
  if (!clip) return { error: null, warning: null }

  if (clip.samples.length === 0) {
    return { error: 'This file decoded to zero samples, so there is nothing to recover.', warning: null }
  }
  if (peak(clip.samples) === 0) {
    return { error: 'This file is completely silent. A stego file always carries its cover audio, so this is not one.', warning: null }
  }
  try {
    computeLayout(fftSizeFor(clip.samples.length), SAMPLE_RATE)
  } catch (e) {
    return { error: `${e instanceof Error ? e.message : String(e)} This clip is too short to hold the hidden band.`, warning: null }
  }
  if (clip.truncated) {
    return { error: null, warning: `Only the first ${MAX_DURATION_S} s of this file is used, so anything hidden after that is lost.` }
  }
  return { error: null, warning: null }
}

export interface KeyCheck {
  error: string | null
  warning: string | null
}

/** `decode()` rejects a blank key; spacing is legal but almost always a mistake. */
export function checkReceiverKey(key: string): KeyCheck {
  if (key.trim().length === 0) {
    return { error: 'Enter the key the sender used. Without it nothing can be unscrambled.', warning: null }
  }
  if (key !== key.trim()) {
    return { error: null, warning: 'This key starts or ends with a space. It must match the sender’s key character for character.' }
  }
  return { error: null, warning: null }
}

export type Verdict = 'ok' | 'voice-verified' | 'auth-failed' | 'no-payload'

export type Verification = 'verified' | 'failed' | 'unavailable'

export interface VerdictCopy {
  tone: 'ok' | 'bad' | 'unsure'
  /** True only when AES-GCM authenticated the frame — the only state that may be presented as success. */
  success: boolean
  verification: Verification
  title: string
  detail: string
  /** What the receiver can try next, most likely fix first. Empty on success. */
  actions: string[]
}

/** Plain-language reading of what the decode actually proved, with no reference to sender state. */
export function recoveryVerdict(status: Verdict, content: FrameContent | null = null): VerdictCopy {
  if (status === 'ok') {
    return {
      tone: 'ok',
      success: true,
      verification: 'verified',
      title: content === 'voice+text' ? 'Message recovered and authenticated' : 'Text recovered and authenticated',
      detail:
        content === 'voice+text'
          ? 'AES-GCM authenticated the text, so the key matches the sender’s. This older-format file also carries a voice; the voice band itself cannot be authenticated.'
          : 'AES-GCM authenticated the text, which proves the key matches the sender’s and the text bits arrived intact.',
      actions: [],
    }
  }
  if (status === 'voice-verified') {
    return {
      tone: 'ok',
      success: true,
      verification: 'verified',
      title: 'Key verified — voice recovered',
      detail:
        'The voice frame’s AES-GCM key token authenticated, so the key matches the sender’s. The voice is an analogue signal: its quality cannot be authenticated, only heard.',
      actions: [],
    }
  }
  if (status === 'auth-failed') {
    return {
      tone: 'bad',
      success: false,
      verification: 'failed',
      title: 'Unable to authenticate the payload',
      detail: 'Check the key or verify that the audio has not been damaged. A frame was found, but its AES-GCM tag did not verify, so nothing is shown.',
      actions: [
        'Check the key for typos, capital letters and leading or trailing spaces.',
        'Make sure the file was not re-encoded (MP3, AAC, voice-note apps) or edited after it was created.',
        'If it went through a noisy channel, ask the sender for the original WAV export.',
      ],
    }
  }
  return {
    tone: 'unsure',
    success: false,
    verification: 'unavailable',
    title: 'No hidden frame found',
    detail:
      'No frame synchronised with this key. Either the key is wrong, this is not a SpectraHide file, or the top of the spectrum was removed. Original-format files that hid only a voice carry no frame at all — for those, key verification is unavailable; listen to the recovered audio to judge.',
    actions: [
      'Re-type the key exactly as the sender shared it.',
      'Use the WAV file exactly as exported — lossy formats (MP3, AAC, OGG) cut the 16–22 kHz bands that carry the message.',
      'Avoid trimming, resampling or editing the file before decoding.',
    ],
  }
}
