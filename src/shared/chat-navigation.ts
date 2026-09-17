/** Fixed entry point for the embedded DeepSeek Chat surface. */
export const CHAT_URL = 'https://chat.deepseek.com/'

/** Persistent Electron partition used by the embedded DeepSeek Chat surface. */
export const CHAT_PARTITION = 'persist:dsh-deepseek-chat'

/** Classification of a URL presented to the Chat navigation policy. */
export type ChatUrlClass = 'chat' | 'auth' | 'external-web' | 'blocked'

/** Event source that requested a Chat navigation. */
export type ChatNavigationSource = 'new-window' | 'top-level' | 'redirect'

/** Action selected by the Chat navigation policy. */
export type ChatNavigationDecision = 'allow' | 'open-external' | 'offer-external' | 'block'

const CHAT_ORIGINS = new Set([new URL(CHAT_URL).origin])
const AUTH_ORIGINS = new Set<string>()

/**
 * Classifies a URL using the exact trusted Chat and authentication origins.
 *
 * @param raw URL text supplied by the navigation event.
 * @returns The policy classification for the URL.
 */
export function classifyChatUrl(raw: string): ChatUrlClass {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'blocked'
  }

  if (url.protocol !== 'https:') {
    return 'blocked'
  }
  if (CHAT_ORIGINS.has(url.origin)) {
    return 'chat'
  }
  if (AUTH_ORIGINS.has(url.origin)) {
    return 'auth'
  }
  return 'external-web'
}

/**
 * Chooses the action for a Chat navigation request.
 *
 * @param source Navigation event source.
 * @param raw URL text supplied by the navigation event.
 * @returns The action that a later Electron controller should perform.
 */
export function decideChatNavigation(
  source: ChatNavigationSource,
  raw: string,
): ChatNavigationDecision {
  const urlClass = classifyChatUrl(raw)
  if (urlClass === 'chat' || urlClass === 'auth') {
    return 'allow'
  }
  if (urlClass !== 'external-web') {
    return 'block'
  }
  if (source === 'new-window') {
    return 'open-external'
  }
  if (source === 'top-level') {
    return 'offer-external'
  }
  return 'block'
}
