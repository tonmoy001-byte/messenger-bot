import { useEffect, useRef } from "react"
import { io, Socket } from "socket.io-client"

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:3000"

let socket: Socket | null = null

export function useSocket(onMessage?: (data: any) => void) {
  const callbackRef = useRef(onMessage)
  callbackRef.current = onMessage

  useEffect(() => {
    if (!socket) {
      socket = io(SOCKET_URL, {
        transports: ["websocket", "polling"],
      })
    }

    const handleNewMessage = (data: any) => {
      callbackRef.current?.(data)
    }

    socket.on("new_message", handleNewMessage)
    socket.on("complaint_detected", handleNewMessage)

    return () => {
      socket?.off("new_message", handleNewMessage)
      socket?.off("complaint_detected", handleNewMessage)
    }
  }, [])
}
