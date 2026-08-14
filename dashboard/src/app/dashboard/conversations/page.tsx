"use client"

import { useEffect, useState, useRef } from "react"
import { io } from "socket.io-client"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { BotOff, Loader2, RotateCcw, Search, Send, UserRoundCheck } from "lucide-react"
import { timeAgo } from "@/lib/utils"

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [reply, setReply] = useState("")
  const [search, setSearch] = useState("")
  const [handoffBusy, setHandoffBusy] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<any>(null)
  const socketRef = useRef<any>(null)

  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    const socket = io("", { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("new_message", (data: any) => {
      const uid = data.uid
      setConversations((prev) => {
        const exists = prev.some((c) => c.customerId === uid)
        const existing = prev.find((c) => c.customerId === uid)
        const updated = {
          customerId: uid,
          customerName: data.customerName || existing?.customerName || "Unknown",
          platform: data.platform || existing?.platform || "messenger",
          lastMessage: data.content || "",
          lastMessageTime: data.timestamp || new Date().toISOString(),
          handoffStatus: data.handoffStatus || existing?.handoffStatus || "ai_active",
        }
        return exists ? prev.map((c) => (c.customerId === uid ? { ...c, ...updated } : c)) : [updated, ...prev]
      })
      if (selectedRef.current?.customerId === uid) {
        setMessages((prev) => [...prev, { role: data.role || "model", content: data.content || "", timestamp: data.timestamp }])
      }
    })

    socket.on("human_handoff_message", (data: any) => {
      const handoffStatus = data.handoffStatus || "human_requested"
      setConversations((prev) =>
        prev.map((c) => (c.customerId === data.uid ? { ...c, handoffStatus } : c))
      )
      if (selectedRef.current?.customerId === data.uid) {
        setSelected((current: any) => current ? { ...current, handoffStatus } : current)
      }
    })

    socket.on("human_handoff_updated", (data: any) => {
      setConversations((prev) =>
        prev.map((c) => (c.customerId === data.uid ? { ...c, handoffStatus: data.handoffStatus } : c))
      )
      if (selectedRef.current?.customerId === data.uid) {
        setSelected((current: any) => current ? { ...current, handoffStatus: data.handoffStatus } : current)
      }
    })

    socket.on("connect_error", () => {})

    return () => { socketRef.current = null; socket.disconnect() }
  }, [])

  useEffect(() => {
    fetch("/api/admin/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const selectConversation = async (conv: any) => {
    setSelected(conv)
    try {
      const res = await fetch(`/api/admin/messages/${conv.customerId}`)
      const data = await res.json()
      setMessages(Array.isArray(data) ? data : data.messages || [])
    } catch { setMessages([]) }
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100)
  }

  const updateHandoff = async (action: "takeover" | "resume") => {
    if (!selected || handoffBusy) return
    setHandoffBusy(true)
    try {
      const res = await fetch(`/api/admin/conversations/${selected.customerId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to update handoff")
      const handoffStatus = data.handoffStatus
      setSelected((current: any) => current ? { ...current, handoffStatus } : current)
      setConversations((prev) => prev.map((c) => c.customerId === selected.customerId ? { ...c, handoffStatus } : c))
    } catch (error) {
      console.error(error)
    } finally {
      setHandoffBusy(false)
    }
  }

  const sendReply = async () => {
    if (!reply.trim() || !selected) return
    try {
      const res = await fetch("/api/admin/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: selected.customerId, message: reply, platform: selected.platform }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to send reply")
      const handoffStatus = data.handoffStatus || "human_active"
      setSelected((current: any) => current ? { ...current, handoffStatus } : current)
      setConversations((prev) => prev.map((c) => c.customerId === selected.customerId ? { ...c, handoffStatus } : c))
      if (!socketRef.current?.connected) {
        setMessages((prev) => [...prev, { role: "model", content: reply, timestamp: new Date().toISOString() }])
      }
      setConversations((prev) => prev.map((c) => (c.customerId === selected.customerId ? { ...c, lastMessage: reply, lastMessageTime: new Date().toISOString() } : c)))
      setReply("")
      setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100)
    } catch {}
  }

  const filtered = conversations.filter(
    (c) => c.customerName?.toLowerCase().includes(search.toLowerCase()) || c.customerId?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted-foreground">Manage customer chats</p>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-4 h-[calc(100vh-12rem)]">
        {/* Conversation list */}
        <div className="rounded-2xl bg-card flex flex-col overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="p-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No conversations</p>
            ) : (
              filtered.map((c, i) => (
                <div
                  key={`${c.customerId}-${i}`}
                  className={`p-3 border-b border-border/20 cursor-pointer transition-colors hover:bg-muted/40 ${selected?.customerId === c.customerId ? "bg-muted/60" : ""}`}
                  onClick={() => selectConversation(c)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{c.customerName || "Unknown"}</span>
                    <Badge variant="secondary" className="text-[10px] capitalize">{c.platform}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">{c.lastMessage || "No messages"}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-muted-foreground/70">{timeAgo(c.lastMessageTime)}</p>
                    {c.handoffStatus && c.handoffStatus !== "ai_active" && (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">AI paused</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat panel */}
        <div className="rounded-2xl bg-card flex flex-col overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          {selected ? (
            <>
              <div className="p-4 border-b border-border/30 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">{selected.customerName || selected.customerPhone}</span>
                  <Badge variant="secondary" className="ml-2 text-xs capitalize">{selected.platform}</Badge>
                  {selected.handoffStatus && selected.handoffStatus !== "ai_active" && (
                    <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-300">
                      <BotOff className="h-3 w-3 mr-1" /> AI paused
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={selected.handoffStatus === "ai_active" ? "outline" : "secondary"}
                  onClick={() => updateHandoff(selected.handoffStatus === "ai_active" ? "takeover" : "resume")}
                  disabled={handoffBusy}
                >
                  {selected.handoffStatus === "ai_active" ? (
                    <><UserRoundCheck className="h-3.5 w-3.5 mr-1.5" />Take over</>
                  ) : (
                    <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Resume AI</>
                  )}
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "model" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${m.role === "model" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEnd} />
              </div>
              <div className="p-4 border-t border-border/30 flex gap-2">
                <Input
                  placeholder={selected.handoffStatus === "ai_active" ? "Type a reply — sending will pause AI" : "Reply as human staff..."}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendReply()}
                />
                <Button size="icon" onClick={sendReply}><Send className="h-4 w-4" /></Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
