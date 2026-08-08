"use client"

import { useEffect, useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Upload, Edit, Search, FileText, Building2, Tag, Clock, MoreVertical } from "lucide-react"
import { timeAgo } from "@/lib/utils"
import { toast } from "sonner"

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("rag")
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ title: "", content: "", keywords: "", category: "" })
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchEntries = (type?: string) => {
    setLoading(true)
    const url = type ? `/api/admin/knowledge?type=${type}` : "/api/admin/knowledge"
    fetch(url)
      .then((r) => r.json())
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchEntries(tab) }, [tab])

  const filteredEntries = useMemo(() => {
    if (!searchQuery) return entries
    const q = searchQuery.toLowerCase()
    return entries.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.content?.toLowerCase().includes(q) ||
      e.tags?.some((t: string) => t.toLowerCase().includes(q))
    )
  }, [entries, searchQuery])

  const ragCount = useMemo(() => entries.filter(e => e.type === "rag").length, [entries])
  const businessCount = useMemo(() => entries.filter(e => e.type === "business_info").length, [entries])

  const handleSave = async () => {
    if (!form.title || !form.content) { toast.error("Title and content required"); return }
    const body = { ...form, type: tab, tags: form.keywords ? form.keywords.split(",").map((k) => k.trim()) : [] }
    try {
      if (editing) {
        await fetch(`/api/admin/knowledge/${editing.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        })
        toast.success("Entry updated")
      } else {
        await fetch("/api/admin/knowledge", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        })
        toast.success("Entry created")
      }
      setShowDialog(false)
      setEditing(null)
      setForm({ title: "", content: "", keywords: "", category: "" })
      fetchEntries(tab)
    } catch { toast.error("Failed to save entry") }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" })
      toast.success("Entry deleted")
      fetchEntries(tab)
    } catch { toast.error("Failed to delete entry") }
    finally { setDeletingId(null) }
  }

  const handleFileUpload = async () => {
    if (!uploadFile) return
    const fd = new FormData()
    fd.append("file", uploadFile)
    try {
      await fetch("/api/admin/knowledge/upload", { method: "POST", body: fd })
      toast.success("File uploaded and processed")
      setUploadFile(null)
      fetchEntries(tab)
    } catch { toast.error("Upload failed") }
  }

  const openEdit = (entry: any) => {
    setEditing(entry)
    setForm({ title: entry.title, content: entry.content, keywords: entry.tags?.join(", ") || "", category: entry.category || "" })
    setShowDialog(true)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ title: "", content: "", keywords: "", category: "" })
    setShowDialog(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            Manage your bot&apos;s knowledge sources and business information
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            id="kb-upload"
            className="hidden"
            accept=".txt,.pdf,.csv"
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
          />
          <Button variant="outline" onClick={() => document.getElementById("kb-upload")?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </div>
      </div>

      {uploadFile && (
        <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{uploadFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(uploadFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setUploadFile(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleFileUpload}>
              Upload & Process
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="rag" className="gap-2">
              <FileText className="h-4 w-4" />
              RAG Entries
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {ragCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="business_info" className="gap-2">
              <Building2 className="h-4 w-4" />
              Business Info
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {businessCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 max-w-sm ml-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value={tab} className="mt-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading entries...</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
                {searchQuery ? (
                  <Search className="h-8 w-8 text-muted-foreground" />
                ) : tab === "rag" ? (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <Building2 className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {searchQuery
                    ? "No entries found"
                    : tab === "rag"
                    ? "No RAG entries yet"
                    : "No business info yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery
                    ? "Try a different search term"
                    : tab === "rag"
                    ? "Add knowledge entries to help your bot answer questions"
                    : "Add business information to personalize your bot's responses"}
                </p>
              </div>
              {!searchQuery && (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entry
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="group relative rounded-xl bg-card p-5 transition-all hover:shadow-md border border-transparent hover:border-border"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-medium line-clamp-1">{entry.title}</h3>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(entry)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deletingId === entry.id}
                      >
                        {deletingId === entry.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                    {entry.content}
                  </p>

                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {entry.tags.slice(0, 4).map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {entry.tags.length > 4 && (
                        <Badge variant="secondary" className="text-xs">
                          +{entry.tags.length - 4}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo(entry.updatedAt)}</span>
                    {entry.category && (
                      <>
                        <span className="text-border">|</span>
                        <span>{entry.category}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Entry" : "Add Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., Return Policy, Product FAQ"
              />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Enter the knowledge content..."
                rows={5}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Keywords</Label>
                <Input
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="refund, return, policy"
                />
                <p className="text-xs text-muted-foreground">Comma-separated</p>
              </div>
              {tab === "rag" && (
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="e.g., products, policies"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? "Update Entry" : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
