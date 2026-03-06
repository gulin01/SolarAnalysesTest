'use client'

import { useEffect, useRef, useCallback } from 'react'
import { WS_RECONNECT_MS } from '@/lib/constants'

interface WSMessage {
  type: string
  [key: string]: unknown
}

interface UseWebSocketOptions {
  onMessage: (msg: WSMessage) => void
  enabled?: boolean
}

export function useWebSocket(url: string | null, { onMessage, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!url || !enabled) return
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (enabled) {
        reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS)
      }
    }

    ws.onerror = () => ws.close()
  }, [url, enabled])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])
}
