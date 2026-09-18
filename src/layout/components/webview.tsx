import { useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { useChatLayout } from '@/hooks/use-chat-layout'
import { useDshStyle } from '@/hooks/use-dsh-style'
import { useIframeMessage } from '@/hooks/use-iframe-message'
import { useIframePost } from '@/hooks/use-iframe-post'
import { store } from '@/store'
import { Recovery } from '@/ui/plugin/recovery'
import { ChatSurface } from './chat-surface'
import { Iframe } from './iframe'
import { Navbar } from './navbar'
import { Setup } from './setup'
import { PreinstallSetup } from './setup-preinstall'

/** 导航桥回报消息类型（iframe → 宿主） */
interface NavBridgeMessage {
  type?: string
  collapsed?: boolean
}

/**
 * 主区域视图（Webview）
 *
 * 壳层导航栏（Navbar）常驻顶部，根据 harness 状态动态渲染主内容区：
 * - error: 错误页 / 插件全屏恢复页
 * - preinstall: 预装插件引导页
 * - ready: 渲染标准 iframe 界面
 * - other: 通用初始化 Setup 页
 */
export function Webview() {
  // 1. 状态与引用声明
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const mode = useStore(store.desktopMode)
  useChatLayout(contentRef)
  const post = useIframePost(iframeRef)

  const [dshStyle] = useDshStyle()

  const { status } = useStore(store.harness)
  const { recovery } = useStore(store.recovery)

  // 2. Iframe 消息通信监听
  useIframeMessage<NavBridgeMessage>(iframeRef, (data) => {
    if (data.type === 'dsh://sidebar:collapsed') {
      setSidebarCollapsed(Boolean(data.collapsed))
    }
  })

  // 4. 根据当前状态决定中间区域渲染内容
  const renderContent = () => {
    switch (status) {
      case 'error':
        return (
          <If cond={recovery.required} else={<Setup />}>
            <Recovery fullScreen />
          </If>
        )
      case 'preinstall':
        return <PreinstallSetup />
      case 'ready':
        return <Iframe iframeRef={iframeRef} />
      default:
        return <Setup />
    }
  }

  function harnessAction(type: string) {
    if (mode.selected === 'harness' && status === 'ready')
      post({ type })
  }

  // 5. 统一布局输出
  return (
    <main className="relative flex flex-col min-h-0 flex-1" style={dshStyle.frame || {}}>
      <Navbar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={mode.selected === 'harness' && status === 'ready' ? () => harnessAction('dsh://sidebar:toggle') : undefined}
        onNewChat={mode.selected === 'harness' && status === 'ready' ? () => harnessAction('dsh://session:new') : undefined}
        onOpenFolder={mode.selected === 'harness' && status === 'ready' ? () => harnessAction('dsh://workspace:add') : undefined}
      />
      <div ref={contentRef} className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1" hidden={mode.selected !== 'harness'} style={{ display: mode.selected === 'harness' ? 'flex' : 'none' }}>
          {renderContent()}
        </div>
        <If cond={mode.selected === 'chat'}>
          <ChatSurface />
        </If>
      </div>
    </main>
  )
}
