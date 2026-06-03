import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: apiService.getSettings,
  })

  const [form, setForm] = useState({
    businessName: "",
    tone: "professional",
    timezone: "UTC",
    customInstructions: "",
    autoReply: true,
  })

  useEffect(() => {
    if (settings) {
      setForm({
        businessName: settings.businessName || "",
        tone: settings.tone || "professional",
        timezone: settings.timezone || "UTC",
        customInstructions: settings.customInstructions || "",
        autoReply: settings.autoReply ?? true,
      })
    }
  }, [settings])

  const updateMutation = useMutation({
    mutationFn: apiService.updateSettings,
    onSuccess: () => {
      toast.success("Settings saved")
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast.error("Failed to save settings"),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate(form)
  }

  if (isLoading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure your AI assistant</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Business Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Business Name</Label>
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">AI Behavior</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={form.tone} onValueChange={(v) => setForm({ ...form, tone: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                  <SelectItem value="formal">Formal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Custom Instructions</Label>
              <Textarea value={form.customInstructions} onChange={(e) => setForm({ ...form, customInstructions: e.target.value })} rows={4} placeholder="Add custom instructions for the AI..." />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Settings
        </Button>
      </form>
    </div>
  )
}
