/**
 * isMobile.ts
 *
 * Returns true when running on a mobile/touch device where SpeechRecognition
 * is unreliable (iOS Safari, Android Chrome) and we prefer ElevenLabs Scribe.
 *
 * Desktop/laptop browsers (including Chromebooks) return false and continue
 * to use the native SpeechRecognition API, which works reliably on desktop.
 *
 * Detection strategy:
 *  1. Check navigator.maxTouchPoints — the most reliable proxy for touch-first
 *     hardware. Tablets and phones always have ≥1 touch point; desktop/laptop
 *     mice report 0. (iPads also report a high touch count, which is correct —
 *     they should use Scribe.)
 *  2. Cross-validate with a UA string check for known mobile/tablet tokens.
 *     This prevents false positives on touchscreen laptops (Surface, etc.),
 *     which have touch points but should still use SpeechRecognition.
 *
 * Called once per component mount — cheap and synchronous.
 */

export function isMobile(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  // Explicit mobile/tablet UA tokens
  const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|WPDesktop|Opera Mini/i.test(ua);

  // maxTouchPoints > 0 alone catches touch-screen laptops too — so we require
  // the UA signal as well to avoid false positives on Surface/Chromebook.
  const touchFirst = navigator.maxTouchPoints > 0 && mobileUA;

  return touchFirst;
}
