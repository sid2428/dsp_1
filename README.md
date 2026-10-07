# SpectraHide — Audio-in-Audio Steganography with FFT

A website that hides a **secret voice message** and an **encrypted text message** inside a music track and
recovers both at the receiver using a **radix-2 FFT (DIT or DIF)**. Every step is visualised: block diagrams, spectra, spectrograms, an animated
**butterfly diagram** of the decoder's FFT, and audio players for both outputs.

All signal processing is written from scratch in TypeScript and runs in the browser (Web Worker). No server.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 48 unit tests for the DSP core
npm run build      # production build in dist/ (serve with: npm run preview)
```

## The flow (5 steps)

| Step | What happens |
|---|---|
| 1 · Sender | Load cover music + secret voice (upload, record from mic, or demo clips), choose a key, optionally type a hidden text |
| 2 · Encode | Animated encoder block diagram; click any block to hear / see the signal there |
| 3 · Channel | Animated transmission; optional noise, volume change, 16-bit WAV quantisation |
| 4 · Receiver | FFT decoding: animated DIT/DIF butterflies on real samples + decoder block diagram |
| 5 · Output | Play the stego audio (what everyone hears) and the recovered secret (what the key holder hears); decrypted hidden text with BER, constellation and bit grid; metrics; wrong-key demo |

A receiver on another computer can skip straight to step 4 with **"Received a stego file? Decode it directly"**.

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
- Lossy compression (MP3, WhatsApp voice notes) usually removes content above ~16 kHz, so the stego file must be sent as **WAV**.
- Security comes from the key-driven permutation; time reversal and spectral inversion alone are keyless scrambles.

## Project structure

```
src/
  dsp/           FFT, FIR, spectral ops, encoder/decoder, metrics, WAV I/O (+ *.test.ts)
  worker/        Web Worker running the DSP off the UI thread
  audio/         decoding uploads, mic recording, WAV download
  pipeline/      block-diagram definitions and theory text for every stage
  components/    charts (D3/canvas), React Flow pipeline, butterfly visualiser, players (wavesurfer.js)
  steps/         the five screens
  store/         Zustand app state
public/samples/  demo cover (synthesised music) and secret (Windows TTS voice)
```

Stack: Vite · React 19 · TypeScript (strict) · Tailwind CSS 4 · Framer Motion (`motion`) · React Flow ·
wavesurfer.js · D3 · Zustand · Radix UI · Vitest.
