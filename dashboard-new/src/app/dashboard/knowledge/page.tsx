"use client"

import { useEffect, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Upload, Edit } from "lucide-react"
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
    } catch { toast.error("Failed") }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" })
    toast.success("Deleted")
    fetchEntries(tab)
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
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">{entries.length} entries</p>
        </div>
        <div className="flex gap-2">
          <div>
            <input type="file" id="kb-upload" className="hidden" accept=".txt,.pdf,.csv" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
            <Button variant="outline" onClick={() => document.getElementById("kb-upload")?.click()}>
              <Upload className="h-4 w-4 mr-2" />Upload File
            </Button>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Entry</Button>
        </div>
      </div>

      {uploadFile && (
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4 flex items-center justify-between">
          <span className="text-sm font-medium">Ready to upload: {uploadFile.name}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setUploadFile(null)}>Cancel</Button>
            <Button size="sm" onClick={handleFileUpload}>Upload</Button>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rag">RAG Entries</TabsTrigger>
          <TabsTrigger value="business_info">Business Info</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : entries.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No entries yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.title}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">{e.content?.slice(0, 80)}...</TableCell>
                      <TableCell>{e.tags?.map((k: string) => <Badge key={k} variant="secondary" className="mr-1 text-xs">{k}</Badge>)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{timeAgo(e.updatedAt)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" onClick={() => openEdit(e)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Entry" : "Add Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Entry title" />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Entry content" rows={4} />
            </div>
            <div className="space-y-2">
              <Label>Keywords (comma separated)</Label>
              <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="keyword1, keyword2" />
            </div>
            {tab === "rag" && (
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g., products, policies" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
