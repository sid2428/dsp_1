# SpectraHide — Audio Steganography with FFT

Hide an **encrypted text message**, a **secret voice recording**, or both inside an ordinary music track, and recover
them with a **radix-2 FFT (DIT or DIF)**. Every stage is drawn from the real data: block diagrams lit by the worker's
own progress reports, calibrated power spectra, spectrograms, an animated butterfly diagram of the decoder's FFT,
and players for every intermediate signal.

All signal processing is written from scratch in TypeScript and runs in the browser (Web Worker). No server.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the DSP core, validation and frame formats
npm run build      # type-check + production build in dist/ (serve with: npm run preview)
```

## The flow (5 stages)

| Stage | What happens |
|---|---|
| 01 · Sender | Cover audio + **one** payload — Text **or** Voice — + key. Real metadata, byte-exact UTF-8 capacity, live mic level, dictation where the browser offers speech recognition |
| 02 · Encode | Runs automatically in a Web Worker; blocks light as each stage really finishes (measured times). Cover-vs-stego spectrum with hover readout, the encoder's own FFT as an interactive butterfly diagram, and an optional block-by-block walkthrough |
| 03 · Transfer | The original sender → channel → receiver animation. Download `stego.wav`, or run the channel simulator (Clean / Noisy / Low-pass presets, or custom), compare cover / TX / RX, and run a stress test that decodes each preset for real |
| 04 · Receiver | Independent: upload a file → type the key → decode. Nothing is taken from the sender. Decoding can be cancelled. Decoder walkthrough + butterfly explorer |
| 05 · Results | Only AES-GCM-verified output is presented as recovered; copy / .txt for text, playback / .wav for voice; failure guidance; Technical Details (constellation, bits, wrong-key control, sender-vs-receiver metrics only when the file is provably from this session); JSON report (never contains the key) |

The Receiver works on its own, so a person on another computer can open it directly and decode a downloaded file.

## Frame format and verification

The text lane starts with a 24-bit header: a sync byte and a 16-bit payload length. The payload is always
salt (16) ‖ IV (12) ‖ AES-256-GCM ciphertext ‖ tag (16), keyed with PBKDF2-SHA256.

| Sync byte | Payload | Receiver can verify |
|---|---|---|
| `0xA5` | voice + text (original format) | the key and the text |
| `0xA6` | text | the key and the text |
| `0xA7` | voice; the frame holds AES-GCM of an empty plaintext | the key (the analogue voice itself cannot be authenticated) |
| none | original-format voice-only files | nothing — reported as “verification unavailable” |

## Animation

The sender → channel → receiver strip (`src/components/channel/transmission-animation.tsx`) is the original from
commit `7c5ba4f`: PCM packets, noise particles, endpoint light-up and the 2.2 s minimum transmission time are kept;
phases for encoding, decoding, verified and failed were added, all driven by real state.

## Signal chain

```
SENDER
secret ─► FIR band-pass 300–3400 Hz ─► time reversal ─► FFT ─► spectral inversion ─► keyed permutation
        (1023 taps, Hamming)          x[−n] ⟷ X*(k)          f → f_lo+f_hi−f       (16 sub-bands)
                                                                                         │
cover ─► FFT ─► band-stop (clear 16.5–19.9 kHz + 20.1–21.9 kHz) ─► Σ ◄── shift up to 16.5 kHz, scale
                                                                    ▲
text ─► AES-256-GCM ─► [0xA5 | length | ciphertext] bits ─► BPSK ×16 key-seeded chips ─► 20.1–21.9 kHz
                                                                    │
                                                                  IFFT ─► stego.wav

RECEIVER
stego ─► FFT (radix-2 DIT/DIF) ─► keep 16.5–19.9 kHz ─► shift down ─► inverse permutation (key)
      ─► spectral inversion ─► IFFT ─► time reversal ─► secret voice
        └─► keep 20.1–21.9 kHz ─► despread (Σ chip·X[k]) ─► sign → bits ─► AES-GCM decrypt ─► hidden text
```

DSP ideas used (all in `src/dsp/`):

- **Radix-2 FFT, DIT and DIF** (`fft.ts`): same routine for the decoder and the butterfly animation (`traceFft`).
- **Windowed-sinc FIR design** + fast convolution (`fir.ts`).
- **Time-reversal property** `x[L−1−n] ⟷ X*[k]·e^{−j2πk(L−1)/N}`: reversal done in the frequency domain (`stego.ts`).
- **Spectral inversion** (reverse + conjugate bins), **SSB frequency shifting** by moving bins, **Hermitian symmetry** for real output (`spectral-ops.ts`).
- **Two-for-one FFT**: two real signals per complex FFT/IFFT (halves the work).
- **Key-seeded Fisher–Yates permutation** of 16 sub-bands (`prng.ts`): 16! ≈ 2×10¹³ orders.
- **Welch PSD**, STFT spectrogram, SNR, segmental SNR, correlation (`analysis.ts`).
- **Hidden text lane** (`bit-lane.ts`, `crypto.ts`): AES-256-GCM (PBKDF2 key), BPSK phase coding on FFT bins,
  direct-sequence spreading with a key-seeded ±1 chip sequence (16 chips/bit → 12 dB processing gain), sync header,
  bit-error rate and constellation. Capacity ≈ 120 characters for an 11.5 s cover.

## Measured results (demo clips, key `dsp-cie-2026`, −20 dB strength)

| Metric | Value |
|---|---|
| Cover vs stego SNR | 19 dB |
| Recovered secret vs original (clean channel, 16-bit WAV) | ~38–40 dB SNR, correlation 1.000 |
| Recovered with the **wrong key** | ~0 dB SNR, correlation ≈ 0 (unintelligible) |
| Through a 40 dB-SNR noisy channel | correlation > 0.9 |
| Hidden text, clean or 20 dB-SNR channel | 0 bit errors, decrypts and authenticates |
| Hidden text, wrong key | header never syncs (chips differ) → nothing revealed |

## Limitations (good to state in the viva)

- The hidden band is **visible on a spectrogram** at 16.5–19.9 kHz, even though it is hard to hear.
- Lossy compression (MP3, WhatsApp voice notes) usually removes content above ~16 kHz, so the stego file must be sent as **WAV**. Uploads in other formats work only if the browser can decode them.
- Dictation uses the browser's speech recognition; Chrome sends that microphone audio to Google's speech service.
- Security comes from the key-driven permutation; time reversal and spectral inversion alone are keyless scrambles.

## Project structure

```
src/
  dsp/           FFT, FIR, spectral ops, encoder/decoder, metrics, WAV I/O (+ *.test.ts)
  worker/        Web Worker running the DSP off the UI thread
  audio/         decoding uploads, mic recording, WAV download
  pipeline/      encoder/decoder block definitions; walkthrough text built from each real result
  components/    charts (D3/canvas), SVG signal diagrams + walkthrough, butterfly visualiser, players (wavesurfer.js)
  steps/         the five screens
  store/         Zustand app state
public/samples/  demo cover (synthesised music) and secret (Windows TTS voice)
```

Stack: Vite · React 19 · TypeScript (strict) · Tailwind CSS 4 · Motion for React · wavesurfer.js · D3 · Zustand · Radix UI · Vitest.
