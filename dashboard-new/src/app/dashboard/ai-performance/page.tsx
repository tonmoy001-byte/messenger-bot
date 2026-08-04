"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, AlertTriangle, Users, Bot, Star, ShoppingCart } from "lucide-react"
import { formatBDT } from "@/lib/utils"

export default function AIPerformancePage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/ai-performance")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI Performance</h1>
        <p className="text-sm text-muted-foreground">Chatbot quality and automation metrics</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Bot, label: "Total Conversations", value: data?.totalConversations || 0, color: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
          { icon: TrendingUp, label: "Automation Rate", value: `${data?.automationRate ?? 0}%`, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400" },
          { icon: Star, label: "Avg Rating", value: data?.avgRating ?? "N/A", sub: `${data?.feedbackCount || 0} reviews`, color: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
          { icon: Users, label: "Handoffs", value: data?.handoffs || 0, sub: `${data?.complaints || 0} complaints`, color: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-semibold mt-1">{stat.value}</p>
            {stat.sub && <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Orders & Revenue (AI-assisted)</h2>
            <p className="text-xs text-muted-foreground">Conversions driven by chatbot</p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Orders Placed</span>
              </div>
              <span className="text-lg font-semibold">{data?.orders || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Revenue Generated</span>
              </div>
              <span className="text-lg font-semibold">{formatBDT(data?.revenue || 0)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Quality Indicators</h2>
            <p className="text-xs text-muted-foreground">Automation and quality breakdown</p>
          </div>
          <div className="space-y-3">
            {[
              { icon: Bot, iconColor: "text-emerald-500", label: "Automated (no handoff)", value: data?.totalConversations > 0 ? `${((data.totalConversations - (data.handoffs || 0)) / data.totalConversations * 100).toFixed(1)}%` : "N/A", badgeVariant: "default" as const },
              { icon: AlertTriangle, iconColor: "text-amber-500", label: "Human handoff rate", value: data?.totalConversations > 0 ? `${((data.handoffs || 0) / data.totalConversations * 100).toFixed(1)}%` : "0%", badgeVariant: "secondary" as const },
              { icon: AlertTriangle, iconColor: "text-red-500", label: "Complaint rate", value: data?.totalConversations > 0 ? `${((data.complaints || 0) / data.totalConversations * 100).toFixed(1)}%` : "0%", badgeVariant: "destructive" as const },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                <div className="flex items-center gap-3">
                  <item.icon className={`h-4 w-4 ${item.iconColor}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <Badge variant={item.badgeVariant}>{item.value}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
