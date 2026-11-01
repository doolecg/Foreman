// The dictation speech model sits in the browser cache; this marker records that it loaded once on this device.
export const SPEECH_MODEL = 'Xenova/whisper-base'
export const SPEECH_MODEL_MARKER = 'foreman.speechModel'

export function speechModelInstalled(): boolean {
  try {
    return localStorage.getItem(SPEECH_MODEL_MARKER) === SPEECH_MODEL
  } catch {
    return false
  }
}

export function markSpeechModelInstalled(): void {
  try {
    localStorage.setItem(SPEECH_MODEL_MARKER, SPEECH_MODEL)
  } catch {
    // storage unavailable: the status stays missing
  }
}
