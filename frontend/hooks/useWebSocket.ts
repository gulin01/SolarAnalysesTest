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

    // Clean up any existing connection before creating a new one
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      wsRef.current.close()
      wsRef.current = null
    }

    const ws = new WebSocket(url)
    wsRef.current = ws

    // Track whether this specific connection has been superseded
    let cancelled = false

    ws.onmessage = (e) => {
      if (cancelled) return
      try {
        const msg = JSON.parse(e.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (cancelled) return
      if (enabled) {
        reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS)
      }
    }

    ws.onerror = () => {
      if (cancelled) return
      ws.close()
    }

    // Return a dispose function for this specific connection
    return () => {
      cancelled = true
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
  }, [url, enabled])

  useEffect(() => {
    const dispose = connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      dispose?.()
      wsRef.current = null
    }
  }, [connect])
}
