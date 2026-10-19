export class SpeechNavigator {
  private muted = false
  private lastSpokenText = ''
  private lastSpokenTimestamp = 0
  private cooldownMs = 20000

  constructor(initialMuted = false, cooldownMs = 20000) {
    this.muted = initialMuted
    this.cooldownMs = cooldownMs
  }

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance !== 'undefined'
    )
  }

  isMuted(): boolean {
    return this.muted
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      this.cancel()
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  /**
   * Speaks an instruction if supported, not muted, and not duplicate within cooldown window.
   */
  speak(text: string, force = false): boolean {
    if (!this.isSupported() || this.muted) return false
    const cleanText = text.trim().replace(/\s+/g, ' ')
    if (!cleanText) return false

    const now = Date.now()
    if (!force && cleanText === this.lastSpokenText && now - this.lastSpokenTimestamp < this.cooldownMs) {
      return false
    }

    try {
      window.speechSynthesis.cancel()
      const utterance = new window.SpeechSynthesisUtterance(cleanText)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.lang = 'en-US'

      window.speechSynthesis.speak(utterance)
      this.lastSpokenText = cleanText
      this.lastSpokenTimestamp = now
      return true
    } catch {
      return false
    }
  }

  cancel(): void {
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // Ignore synthesis abort errors
      }
    }
  }

  reset(): void {
    this.cancel()
    this.lastSpokenText = ''
    this.lastSpokenTimestamp = 0
  }
}
