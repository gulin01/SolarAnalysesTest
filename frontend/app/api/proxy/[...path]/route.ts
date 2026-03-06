import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const FASTAPI_URL = process.env.FASTAPI_INTERNAL_URL ?? 'http://localhost:8000'

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await auth()
  const path = params.path.join('/')
  const url = `${FASTAPI_URL}/api/${path}${req.nextUrl.search}`

  const headers = new Headers()
  headers.set('Content-Type', req.headers.get('Content-Type') ?? 'application/json')
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body as BodyInit
    // @ts-ignore — duplex required for streaming body
    init.duplex = 'half'
  }

  const upstream = await fetch(url, init)
  const body = await upstream.arrayBuffer()

  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const DELETE = handler
