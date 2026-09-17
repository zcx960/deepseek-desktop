/** Versioned adapter for the official DeepSeek Chat sidebar representation. */

/** Official Chat local-storage entry carrying its retained page settings. */
export const CHAT_LAST_SESSION_STORAGE_KEY = '__appKit_@deepseek/chat_lastSessionValue'

const CHAT_LAST_SESSION_STORAGE_VERSION = '0'

/** Decision returned before the isolated preload writes official Chat storage. */
export type ChatSidebarResolution =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'update'; readonly value: string }

/**
 * Resolve the smallest storage update that starts official Chat with its sidebar open.
 * @param raw - Exact retained page-settings value, or `null` before the site initializes it.
 * @returns An update only for the current official version-zero representation.
 */
export function resolveExpandedChatSidebar(raw: string | null): ChatSidebarResolution {
  if (raw === null) return { kind: 'unchanged' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: 'unsupported' }
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'unsupported' }
  }
  const fields = Object.keys(parsed)
  if (fields.length !== 2 || !fields.includes('value') || !fields.includes('__version')) {
    return { kind: 'unsupported' }
  }
  const envelope = parsed as { value?: unknown; __version?: unknown }
  if (envelope.__version !== CHAT_LAST_SESSION_STORAGE_VERSION) return { kind: 'unsupported' }
  const settings = envelope.value
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return { kind: 'unsupported' }
  }
  const sidebarCollapsed = (settings as { siderCollapsed?: unknown }).siderCollapsed
  if (typeof sidebarCollapsed !== 'boolean') return { kind: 'unsupported' }
  if (!sidebarCollapsed) return { kind: 'unchanged' }
  return {
    kind: 'update',
    value: JSON.stringify({
      value: { ...settings, siderCollapsed: false },
      __version: CHAT_LAST_SESSION_STORAGE_VERSION,
    }),
  }
}
