"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"]

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/analytics")
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
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <Badge variant="secondary">30 days</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Total Messages", value: data?.totalMessages || 0 },
          { label: "Unique Customers", value: data?.uniqueCustomers || 0 },
          { label: "Avg Response Time", value: data?.avgResponseTime || "< 1s" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-semibold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Messages by Day</h2>
            <p className="text-xs text-muted-foreground">Daily conversation volume</p>
          </div>
          {data?.messagesByDay?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.messagesByDay}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "var(--shadow-card-hover)" }} />
                <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-16">No data</p>
          )}
        </div>

        <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Platform Distribution</h2>
            <p className="text-xs text-muted-foreground">Conversation sources</p>
          </div>
          {data?.platformBreakdown && Object.keys(data.platformBreakdown).length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={Object.entries(data.platformBreakdown).map(([name, value]) => ({ name, value }))}
                  cx="50%" cy="50%" outerRadius={100} dataKey="value"
                >
                  {Object.entries(data.platformBreakdown).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "var(--shadow-card-hover)" }} />
              </PieChart>
              <div className="flex justify-center gap-4 mt-2">
                {Object.entries(data.platformBreakdown).map(([name], i) => (
                  <div key={name} className="flex items-center gap-1.5 text-xs">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="capitalize text-muted-foreground">{name}</span>
                  </div>
                ))}
              </div>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-16">No data</p>
          )}
        </div>
      </div>
    </div>
  )
}
