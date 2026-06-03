import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Loader2, Plus, Trash2, BookOpen } from "lucide-react"
import { toast } from "sonner"

export default function KnowledgeBase() {
  const queryClient = useQueryClient()
  const [showDialog, setShowDialog] = useState(false)
  const [newEntry, setNewEntry] = useState({ title: "", content: "", category: "general" })

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["knowledge"],
    queryFn: apiService.getKnowledgeBase,
  })

  const createMutation = useMutation({
    mutationFn: apiService.createKnowledgeEntry,
    onSuccess: () => {
      toast.success("Entry added")
      setShowDialog(false)
      setNewEntry({ title: "", content: "", category: "general" })
      queryClient.invalidateQueries({ queryKey: ["knowledge"] })
    },
    onError: () => toast.error("Failed to add entry"),
  })

  const deleteMutation = useMutation({
    mutationFn: apiService.deleteKnowledgeEntry,
    onSuccess: () => {
      toast.success("Entry deleted")
      queryClient.invalidateQueries({ queryKey: ["knowledge"] })
    },
    onError: () => toast.error("Failed to delete"),
  })

  const reindexMutation = useMutation({
    mutationFn: apiService.reindexKnowledge,
    onSuccess: () => toast.success("Knowledge base reindexed"),
    onError: () => toast.error("Failed to reindex"),
  })

  const handleCreate = () => {
    if (!newEntry.title || !newEntry.content) {
      toast.error("Title and content are required")
      return
    }
    createMutation.mutate(newEntry)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">Manage AI training data and FAQs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => reindexMutation.mutate()} disabled={reindexMutation.isPending}>
            {reindexMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BookOpen className="h-4 w-4 mr-2" />}
            Reindex
          </Button>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Entry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Knowledge Entry</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={newEntry.title} onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })} placeholder="e.g., Return Policy" />
                </div>
                <div className="space-y-2">
                  <Label>Content</Label>
                  <Textarea value={newEntry.content} onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })} rows={4} placeholder="Enter the knowledge content..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Content</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
              ) : entries.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No entries yet</TableCell></TableRow>
              ) : (
                entries.map((e: any) => (
                  <TableRow key={e._id}>
                    <TableCell className="font-medium">{e.title}</TableCell>
                    <TableCell><Badge variant="outline">{e.category || "general"}</Badge></TableCell>
                    <TableCell className="max-w-md truncate text-sm text-muted-foreground">{e.content}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(e._id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
