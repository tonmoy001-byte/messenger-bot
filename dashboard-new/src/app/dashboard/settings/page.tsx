"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Loader2, Building2, Bot, Phone, Webhook, CheckCircle2, Circle } from "lucide-react"
import { toast } from "sonner"

const SECTIONS = [
  { id: "business", label: "Business", icon: Building2, description: "Company info" },
  { id: "ai", label: "AI Assistant", icon: Bot, description: "Chatbot config" },
  { id: "contact", label: "Contact", icon: Phone, description: "Reach details" },
  { id: "webhook", label: "Webhook", icon: Webhook, description: "Meta integration" },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState("business")
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const update = (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async (keys: string[]) => {
    setSaving(true)
    const updates: any = {}
    for (const k of keys) updates[k] = settings[k]
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Saved")
      setDirty(false)
    } catch { toast.error("Failed to save") }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your chatbot and business profile</p>
      </div>

      <div className="flex gap-12">
        {/* Sidebar navigation */}
        <nav className="w-48 shrink-0">
          <div className="sticky top-24 space-y-1">
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                    isActive
                      ? "bg-primary/8 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <section.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                  <div className="min-w-0">
                    <div className="truncate">{section.label}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{section.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeSection === "business" && (
            <Section
              title="Business Information"
              description="This info is injected into every AI response as business context."
              onSave={() => handleSave(["businessName", "businessDescription", "businessHours", "businessWebsite", "businessAddress"])}
              saving={saving}
            >
              <div className="grid grid-cols-2 gap-5">
                <Field label="Business Name">
                  <Input
                    value={settings.businessName || ""}
                    onChange={(e) => update("businessName", e.target.value)}
                    placeholder="Acme Corp"
                  />
                </Field>
                <Field label="Business Hours">
                  <Input
                    value={settings.businessHours || ""}
                    onChange={(e) => update("businessHours", e.target.value)}
                    placeholder="10AM - 8PM"
                  />
                </Field>
              </div>
              <Field label="Business Description">
                <Textarea
                  value={settings.businessDescription || ""}
                  onChange={(e) => update("businessDescription", e.target.value)}
                  rows={3}
                  placeholder="Tell customers what your business does..."
                />
              </Field>
              <Field label="Website">
                <Input
                  value={settings.businessWebsite || ""}
                  onChange={(e) => update("businessWebsite", e.target.value)}
                  placeholder="https://example.com"
                />
              </Field>
              <Field label="Address">
                <Input
                  value={settings.businessAddress || ""}
                  onChange={(e) => update("businessAddress", e.target.value)}
                  placeholder="123 Main St, Dhaka"
                />
              </Field>
            </Section>
          )}

          {activeSection === "ai" && (
            <Section
              title="AI Assistant"
              description="Customize how the AI responds to customers."
              onSave={() => handleSave(["systemPrompt", "fallbackMessage", "autoReply"])}
              saving={saving}
            >
              <Field
                label="System Prompt"
                description="Defines the AI's personality, knowledge boundaries, and response style."
              >
                <Textarea
                  value={settings.systemPrompt || ""}
                  onChange={(e) => update("systemPrompt", e.target.value)}
                  rows={8}
                  className="font-mono text-xs leading-relaxed"
                  placeholder="You are a helpful customer support assistant for..."
                />
              </Field>

              <Field
                label="Fallback Reply"
                description="Sent when the AI cannot understand or handle a request."
              >
                <Input
                  value={settings.fallbackMessage || ""}
                  onChange={(e) => update("fallbackMessage", e.target.value)}
                  placeholder="Sorry, I couldn't understand that. Let me connect you with a human."
                />
              </Field>

              <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-muted/30">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">AI Chatbot</Label>
                  <p className="text-xs text-muted-foreground">Enable automatic AI responses to customer messages</p>
                </div>
                <Switch
                  checked={settings.autoReply ?? true}
                  onCheckedChange={(v) => update("autoReply", v)}
                />
              </div>
            </Section>
          )}

          {activeSection === "contact" && (
            <Section
              title="Contact Details"
              description="Phone, email, and social links shown to customers."
              onSave={() => handleSave(["businessPhone", "businessEmail", "facebookPage", "instagramPage"])}
              saving={saving}
            >
              <div className="grid grid-cols-2 gap-5">
                <Field label="Phone">
                  <Input
                    value={settings.businessPhone || ""}
                    onChange={(e) => update("businessPhone", e.target.value)}
                    placeholder="+880 1XXX-XXXXXX"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={settings.businessEmail || ""}
                    onChange={(e) => update("businessEmail", e.target.value)}
                    placeholder="hello@example.com"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-5">
                <Field label="Facebook Page">
                  <Input
                    value={settings.facebookPage || ""}
                    onChange={(e) => update("facebookPage", e.target.value)}
                    placeholder="https://facebook.com/..."
                  />
                </Field>
                <Field label="Instagram">
                  <Input
                    value={settings.instagramPage || ""}
                    onChange={(e) => update("instagramPage", e.target.value)}
                    placeholder="https://instagram.com/..."
                  />
                </Field>
              </div>
            </Section>
          )}

          {activeSection === "webhook" && (
            <Section
              title="Webhook"
              description="Meta webhook and ngrok tunnel status."
              onSave={() => handleSave(["webhookVerifyToken"])}
              saving={saving}
              hideSave
            >
              <Field label="Webhook URL">
                <div className="flex items-center gap-2">
                  <Input
                    value="https://sparrowless-forthcomingly-skyler.ngrok-free.dev/webhook"
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Badge variant="secondary" className="shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />Active
                  </Badge>
                </div>
              </Field>
              <Field label="Verify Token">
                <Input
                  value={settings.webhookVerifyToken || ""}
                  readOnly
                  className="font-mono text-xs"
                />
              </Field>
              <div className="rounded-xl bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
                  <span className="font-medium">ngrok tunnel is active</span>
                </div>
                <p className="text-xs text-muted-foreground pl-4">
                  Your webhook is receiving events from Meta. Messages will be processed automatically.
                </p>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  children,
  onSave,
  saving,
  hideSave,
}: {
  title: string
  description: string
  children: React.ReactNode
  onSave: () => void
  saving: boolean
  hideSave?: boolean
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="rounded-2xl bg-card p-6 space-y-5" style={{ boxShadow: "var(--shadow-card)" }}>
        {children}
        {!hideSave && (
          <div className="flex justify-end pt-2 border-t border-border/30">
            <Button onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save changes
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {description && <p className="text-xs text-muted-foreground -mt-1">{description}</p>}
      {children}
    </div>
  )
}
