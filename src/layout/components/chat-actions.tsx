import { ArrowRotateRight, ArrowUpRightFromSquare, TrashBin } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { useOverlay } from '@overlastic/react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { Modal } from '@/components/modal'
import { store } from '@/store'
import { toast } from '@/utils/toast'

export function ChatActions() {
  const { t } = useTranslation()
  const mode = useStore(store.desktopMode)
  const confirm = useOverlay(Modal)

  async function clearData() {
    try {
      await store.desktopMode.suspendChat()
      try {
        await confirm({ status: 'danger', title: t('chat.clear_title'), description: t('chat.clear_description'), confirmText: t('chat.clear_confirm') })
      }
      catch {
        return
      }
      await store.desktopMode.clearChatData()
    }
    catch (error) {
      toast(t('chat.clear_failed'), { variant: 'danger', description: String(error) })
    }
    finally {
      store.desktopMode.resumeChat()
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <If cond={Boolean(mode.notice)}>
        <span role="status" className="mx-2 text-xs text-muted">{t(mode.notice)}</span>
      </If>
      <Button size="sm" variant="ghost" isIconOnly className="size-7" aria-label={t('chat.reload')} isDisabled={mode.busy} onPress={() => { void store.desktopMode.retryChat() }}><ArrowRotateRight /></Button>
      <Button size="sm" variant="ghost" isIconOnly className="size-7" aria-label={t('chat.open_browser')} onPress={() => { void store.desktopMode.openChatBrowser() }}><ArrowUpRightFromSquare /></Button>
      <Button size="sm" variant="ghost" isIconOnly className="size-7" aria-label={t('chat.clear_title')} isDisabled={mode.busy} onPress={() => { void clearData() }}><TrashBin /></Button>
    </div>
  )
}
