import { Button, Spinner } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { store } from '@/store'

export function ChatSurface() {
  const { t } = useTranslation()
  const mode = useStore(store.desktopMode)
  const failed = mode.chat.phase === 'failed' || Boolean(mode.error)
  let description = 'chat.loading_description'
  if (failed)
    description = 'chat.error_description'
  if (mode.chat.error?.startsWith('CHAT_UNSUPPORTED_OS'))
    description = 'chat.unsupported_os'

  if (mode.chat.phase === 'ready')
    return null

  return (
    <section aria-label={t('chat.mode_chat')} className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-panel p-8 text-center">
      <If cond={!failed}>
        <Spinner />
      </If>
      <h1 className="text-lg font-medium">{t(failed ? 'chat.error_title' : 'chat.loading_title')}</h1>
      <p className="max-w-md text-sm text-muted">{t(description)}</p>
      <If cond={Boolean(mode.error)}><p className="max-w-lg break-words text-xs text-danger">{mode.error}</p></If>
      <If cond={failed}>
        <div className="flex gap-2">
          <Button variant="primary" isDisabled={mode.busy} onPress={() => { void store.desktopMode.retryChat() }}>{t('chat.retry')}</Button>
          <Button variant="tertiary" onPress={() => { void store.desktopMode.openChatBrowser() }}>{t('chat.open_browser')}</Button>
        </div>
      </If>
    </section>
  )
}
