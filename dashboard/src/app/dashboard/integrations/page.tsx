"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Settings2 } from "lucide-react"
import { SiFacebook, SiWhatsapp, SiInstagram, SiShopify, SiWoocommerce } from "react-icons/si"
import { api } from "@/lib/client-api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const SECTIONS = [
  {
    title: "Messaging Channels",
    description: "Where your chatbot lives",
    items: [
      { id: "messenger", name: "Facebook Messenger", description: "Chat with customers on your Facebook Page", icon: SiFacebook, color: "bg-[#1877F2]/10 text-[#1877F2]" },
      { id: "whatsapp", name: "WhatsApp Business", description: "Reply to WhatsApp messages with AI", icon: SiWhatsapp, color: "bg-[#25D366]/10 text-[#25D366]" },
      { id: "instagram", name: "Instagram", description: "Auto-reply to Instagram DMs", icon: SiInstagram, color: "bg-[#E4405F]/10 text-[#E4405F]" },
    ],
  },
  {
    title: "E-commerce",
    description: "Sync products, orders, and inventory",
    items: [
      { id: "shopify", name: "Shopify", description: "Import products and fulfill orders", icon: SiShopify, color: "bg-[#96BF48]/10 text-[#96BF48]" },
      { id: "woocommerce", name: "WooCommerce", description: "WordPress store integration", icon: SiWoocommerce, color: "bg-[#7B51C0]/10 text-[#7B51C0]" },
    ],
  },
  {
    title: "Payments",
    description: "Accept payments through the chatbot",
    items: [
      { id: "bkash", name: "bKash", description: "Mobile financial service", icon: BkashIcon, color: "bg-[#E2136E]/10 text-[#E2136E]" },
      { id: "nagad", name: "Nagad", description: "Digital payment platform", icon: NagadIcon, color: "bg-[#F6921E]/10 text-[#F6921E]" },
    ],
  },
]

function normalizeIntegrations(raw: any): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (raw?.social && Array.isArray(raw.social)) {
    for (const s of raw.social) {
      if (s.platform) result[s.platform.toLowerCase()] = true
    }
  }
  if (raw?.shopify) result.shopify = !!raw.shopify.connected
  if (raw?.woocommerce) result.woocommerce = !!raw.woocommerce.connected
  return result
}

export default function IntegrationsPage() {
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [dialogFor, setDialogFor] = useState<null | "shopify" | "woocommerce">(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    fetch("/api/admin/integrations")
      .then((r) => r.json())
      .then((data) => setStatus(normalizeIntegrations(data)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleConnect = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      if (dialogFor === "shopify") {
        await api.integrations.connectShopify({ storeUrl: form.storeUrl, accessToken: form.accessToken })
      } else {
        await api.integrations.connectWoo({ storeUrl: form.storeUrl, consumerKey: form.consumerKey, consumerSecret: form.consumerSecret })
      }
      setSuccess("Connected successfully")
      setDialogFor(null)
      setForm({})
      const res = await fetch("/api/admin/integrations")
      setStatus(normalizeIntegrations(await res.json()))
    } catch (e: any) {
      setError(e.message || "Failed to connect")
    } finally {
      setSaving(false)
    }
  }

  const connectedCount = Object.values(status).filter(Boolean).length
  const totalCount = SECTIONS.reduce((s, sec) => s + sec.items.length, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {connectedCount} of {totalCount} connected
        </p>
      </div>

      <div className="space-y-10">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
            </div>

            <div className="rounded-2xl bg-card divide-y divide-border/30 overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
              {section.items.map((intg) => {
                const connected = !!status[intg.id]
                const Icon = intg.icon
                return (
                  <div key={intg.id} className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${intg.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{intg.name}</p>
                          {connected && (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{intg.description}</p>
                      </div>
                    </div>
                    <Button
                      variant={connected ? "ghost" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (intg.id === "shopify" || intg.id === "woocommerce") {
                          setDialogFor(intg.id as "shopify" | "woocommerce")
                        } else {
                          window.location.href = "/dashboard/settings"
                        }
                      }}
                    >
                      {connected ? (
                        <><Settings2 className="h-3.5 w-3.5 mr-1.5" />Configure</>
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={dialogFor !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialogFor(null)
            setForm({})
            setError("")
            setSuccess("")
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Connect {dialogFor === "shopify" ? "Shopify" : "WooCommerce"}
            </DialogTitle>
            <DialogDescription>
              Enter your {dialogFor === "shopify" ? "Shopify" : "WooCommerce"} store credentials to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Store URL</Label>
              <Input
                value={form.storeUrl || ""}
                onChange={(e) => setForm({ ...form, storeUrl: e.target.value })}
                placeholder="https://your-store.myshopify.com"
              />
            </div>
            {dialogFor === "shopify" ? (
              <div className="space-y-2">
                <Label>Access Token</Label>
                <Input
                  type="password"
                  value={form.accessToken || ""}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  placeholder="shpat_..."
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Consumer Key</Label>
                  <Input
                    type="password"
                    value={form.consumerKey || ""}
                    onChange={(e) => setForm({ ...form, consumerKey: e.target.value })}
                    placeholder="ck_..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Consumer Secret</Label>
                  <Input
                    type="password"
                    value={form.consumerSecret || ""}
                    onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })}
                    placeholder="cs_..."
                  />
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-emerald-600">{success}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogFor(null)}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={saving}>
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Connecting...</>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* bKash and Nagad don't have Simple Icons, using custom SVGs with brand paths */

function BkashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 15.5v-2.13c-1.44-.22-2.5-1.28-2.72-2.72H7.7v-1.5h.17c.14-1.23 1.18-2.2 2.43-2.3v-1.5h1.5v1.5c1.44.22 2.5 1.28 2.72 2.72h.18v1.5h-.18c-.14 1.23-1.18 2.2-2.43 2.3V17.5h-1.5zm3-4.5c.99-.18 1.76-.95 1.76-1.96 0-1.08-.87-1.96-1.96-1.96h-.8v3.92h.8c.3 0 .59-.05.86-.13l.34.13z" />
    </svg>
  )
}

function NagadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 14h-2l-1.5-4-1.5 4h-2l2.25-6h1.5L15.5 16zm-5-7.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5.67 1.5 1.5 1.5 1.5-.67 1.5-1.5z" />
    </svg>
  )
}
