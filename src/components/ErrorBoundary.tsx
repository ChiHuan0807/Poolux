import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 变化时自动清除错误状态。传入路由路径，用户切走再切回就能自动恢复。 */
  resetKey?: string
}

type State = { error: Error | null }

/**
 * 页面级错误边界。
 *
 * 没有它时，任何一个组件在 render 阶段抛异常（例如接口少返回一个字段导致
 * xxx.map is not a function），React 会把整棵树卸载掉，用户看到的就是纯白屏，
 * 刷新也未必恢复。有它之后至少能看到是哪一段出了错，并且能切走页面自动恢复。
 *
 * 刻意不使用任何第三方图标/组件：它必须在其它代码已经出错时仍然能渲染出来。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 页面渲染出错：', error, '\n组件栈：', info.componentStack)
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          padding: '24px',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '560px',
            padding: '24px',
            borderRadius: '20px',
            background: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h1 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
            页面出错了
          </h1>
          <p style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-muted)', marginBottom: '16px' }}>
            这个页面在渲染时抛了异常，所以显示不出来。下面的信息可以帮助定位问题；
            切换左侧菜单或返回其它页面通常可以继续使用。
          </p>
          <pre
            style={{
              fontSize: '12px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '168px',
              overflow: 'auto',
              padding: '12px',
              borderRadius: '12px',
              background: 'var(--bg-tertiary)',
              color: 'var(--danger)',
              marginBottom: '16px',
            }}
          >
            {error.name}: {error.message}
          </pre>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                background: 'var(--gradient-accent)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
