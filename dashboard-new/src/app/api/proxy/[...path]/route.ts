import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000"

async function proxyRequest(request: NextRequest, path: string) {
  const url = new URL(request.url)
  const backendUrl = `${BACKEND_URL}${path}${url.search}`

  const headers = new Headers()
  // Copy relevant headers
  const skipHeaders = ["host", "connection", "content-length"]
  request.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  // Forward the admin_token cookie as Authorization header
  const token = request.cookies.get("admin_token")?.value
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  // Handle multipart/form-data (file uploads)
  const contentType = request.headers.get("content-type") || ""
  let body: BodyInit | undefined

  if (contentType.includes("multipart/form-data")) {
    body = await request.formData()
    headers.delete("content-type") // browser will set it with boundary
  } else {
    body = await request.text()
  }

  try {
    const res = await fetch(backendUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? body : undefined,
    })

    // Check if response is streaming or binary
    const resContentType = res.headers.get("content-type") || ""

    if (resContentType.includes("text/csv") || resContentType.includes("application/octet-stream")) {
      const buffer = await res.arrayBuffer()
      return new NextResponse(buffer, {
        status: res.status,
        headers: {
          "Content-Type": resContentType,
          "Content-Disposition": res.headers.get("content-Disposition") || "attachment",
        },
      })
    }

    const data = await res.text()
    try {
      const json = JSON.parse(data)
      return NextResponse.json(json, { status: res.status })
    } catch {
      return new NextResponse(data, {
        status: res.status,
        headers: { "Content-Type": resContentType || "text/plain" },
      })
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Backend server unavailable" },
      { status: 502 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  return proxyRequest(request, `/api/${path.join("/")}`)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  return proxyRequest(request, `/api/${path.join("/")}`)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  return proxyRequest(request, `/api/${path.join("/")}`)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  return proxyRequest(request, `/api/${path.join("/")}`)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  return proxyRequest(request, `/api/${path.join("/")}`)
}
