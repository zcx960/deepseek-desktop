import { Button } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'valtio-define'
import { store } from '@/store'

export function ModeSwitch() {
  const { t } = useTranslation()
  const mode = useStore(store.desktopMode)
  return (
    <div role="group" aria-label={t('chat.mode_switch')} className="mx-2 flex shrink-0 items-center gap-0.5 rounded-lg bg-default p-0.5">
      {(['harness', 'chat'] as const).map(value => (
        <Button
          key={value}
          size="sm"
          variant={mode.selected === value ? 'secondary' : 'ghost'}
          className="h-7 min-w-18 rounded-md px-3 text-xs"
          aria-pressed={mode.selected === value}
          isDisabled={!mode.initialized}
          onPress={() => { void store.desktopMode.select(value) }}
        >
          {t(`chat.mode_${value}`)}
        </Button>
      ))}
    </div>
  )
}
