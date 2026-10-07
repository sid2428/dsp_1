/** Working sample rate: every input is resampled to this on load. */
export const SAMPLE_RATE = 44100

/** Telephone-quality speech band kept from the secret voice. */
export const SECRET_LOW_HZ = 300
export const SECRET_HIGH_HZ = 3400

/** Extra bins carried on each side of the speech band so the FIR's transition bands survive transmission. */
export const GUARD_HZ = 150

/** Where the scrambled secret is parked inside the cover (near the top of human hearing). */
export const CARRIER_LOW_HZ = 16500

/** The secret band is cut into this many sub-bands which the key shuffles. */
export const NUM_SUBBANDS = 16

/** FIR band-pass length (odd, linear phase). */
export const FIR_TAPS = 1023

/** Inputs longer than this are trimmed so the FFT never exceeds 2^20 points (≈ 23.7 s at 44.1 kHz). */
export const MAX_DURATION_S = 23

/** Default level of the hidden band relative to the cover (dB). */
export const DEFAULT_STRENGTH_DB = -20

/** Hidden text lane: BPSK + spread-spectrum bits parked above the voice carrier (inaudible). */
export const LANE_LOW_HZ = 20100
export const LANE_HIGH_HZ = 21900

/** FFT bins (chips) each bit is spread over; 16 chips = 12 dB processing gain. */
export const CHIPS_PER_BIT = 16

/** Level of the full text lane relative to the cover (dB). */
export const LANE_STRENGTH_DB = -30
