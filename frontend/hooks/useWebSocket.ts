'use client'

import { useEffect, useRef, useCallback } from 'react'
import { WS_RECONNECT_MS } from '@/lib/constants'

const MAX_RETRIES = 5

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
  const retriesRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!url || !enabled) return

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      retriesRef.current = 0
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (enabled && retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1
        reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS)
      }
    }

    ws.onerror = () => {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close()
      }
    }
  }, [url, enabled])

  useEffect(() => {
    retriesRef.current = 0
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])
}
