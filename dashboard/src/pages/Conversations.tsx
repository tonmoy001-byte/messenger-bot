import { useState, useEffect, useRef } from "react"
import { Send, Search, Loader2, MessageSquare } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { useSocket } from "@/hooks/useSocket"
import { toast } from "sonner"

const filters = [
  { label: "All", value: "all" },
  { label: "Messenger", value: "messenger" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Website", value: "website" },
]

export default function Conversations() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [replyText, setReplyText] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: conversations = [], isLoading: loadingConvos } = useQuery({
    queryKey: ["conversations"],
    queryFn: apiService.getConversations,
  })

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => apiService.getMessages(selectedId!),
    enabled: !!selectedId,
  })

  useSocket((newMsg: any) => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] })
    if (newMsg.uid === selectedId) {
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] })
    }
  })

  const sendMutation = useMutation({
    mutationFn: ({ uid, text, platform }: { uid: string; text: string; platform: string }) =>
      apiService.sendReply(uid, text, platform),
    onSuccess: () => {
      setReplyText("")
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] })
      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: () => {
      toast.error("Failed to send message")
    }
  })

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  const handleSend = () => {
    if (!replyText.trim() || !selectedId || !selectedConvo) return
    sendMutation.mutate({
      uid: selectedId,
      text: replyText,
      platform: selectedConvo.platform === "website" ? "web" : selectedConvo.platform
    })
  }

  const filtered = conversations.filter((c: any) => {
    const platform = c.platform === "web" ? "website" : c.platform
    const matchPlatform = filter === "all" || platform === filter
    const matchSearch = c.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      c.customerId?.toLowerCase().includes(search.toLowerCase())
    return matchPlatform && matchSearch
  })

  const selectedConvo = conversations.find((c: any) => c.customerId === selectedId)

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-4">
      <div className="w-72 shrink-0 flex flex-col border rounded-lg bg-card">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-8 h-8 text-sm border-0 bg-secondary/50 focus-visible:ring-0" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
            {filters.map((f) => (
              <Button key={f.value} variant={filter === f.value ? "default" : "ghost"} size="sm" className="h-6 text-xs shrink-0 px-2" onClick={() => setFilter(f.value)}>
                {f.label}
              </Button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loadingConvos ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin h-4 w-4 text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center p-8 text-sm text-muted-foreground">No conversations found</div>
          ) : (
            filtered.map((c: any) => (
              <button
                key={c.customerId}
                onClick={() => setSelectedId(c.customerId)}
                className={`w-full flex items-start gap-2.5 p-3 border-b text-left transition-colors hover:bg-secondary/50 ${selectedId === c.customerId ? "bg-secondary" : ""}`}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={c.profilePic} />
                  <AvatarFallback className="text-xs">{c.customerName?.substring(0, 2).toUpperCase() || "CU"}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{c.customerName || c.customerId}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(c.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</p>
                </div>
                {c.unread && <div className="h-1.5 w-1.5 rounded-full bg-foreground mt-2 shrink-0" />}
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col border rounded-lg bg-card overflow-hidden">
        {selectedId && selectedConvo ? (
          <>
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2.5">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={selectedConvo.profilePic} />
                  <AvatarFallback className="text-xs">{selectedConvo.customerName?.substring(0, 2).toUpperCase() || "CU"}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{selectedConvo.customerName || selectedConvo.customerId}</p>
                  <span className="text-xs text-muted-foreground capitalize">{selectedConvo.platform === "web" ? "Website" : selectedConvo.platform}</span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase">{selectedConvo.platform}</Badge>
            </div>

            <ScrollArea className="flex-1 p-4">
              {loadingMessages ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin h-4 w-4 text-muted-foreground" /></div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m: any) => (
                    <div key={m._id || m.timestamp} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3.5 py-2 ${m.role === "user" ? "bg-secondary text-secondary-foreground rounded-tl-none" : "bg-foreground text-background rounded-tr-none"}`}>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        <p className={`text-[10px] mt-1 ${m.role === "user" ? "text-muted-foreground" : "text-background/60"}`}>
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={scrollRef} />
                </div>
              )}
            </ScrollArea>

            <form className="p-3 border-t flex gap-2" onSubmit={(e) => { e.preventDefault(); handleSend() }}>
              <Input placeholder="Type a reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)} className="flex-1 h-9 text-sm border-0 bg-secondary/50 focus-visible:ring-0" disabled={sendMutation.isPending} />
              <Button size="icon" type="submit" className="h-9 w-9" disabled={!replyText.trim() || sendMutation.isPending}>
                {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <MessageSquare className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">Select a conversation to start chatting</p>
          </div>
        )}
      </div>
    </div>
  )
}
