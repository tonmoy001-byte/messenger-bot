"use client"

import { useEffect, useState } from "react"
import { ShoppingCart, DollarSign, Users, MessageSquare } from "lucide-react"
import { formatBDT } from "@/lib/utils"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

interface Stats {
  totalCustomers: number
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  messagesToday: number
  revenueByDay: { day: string; revenue: number; orders: number }[]
  platformBreakdown: { platform: string; count: number }[] | Record<string, number>
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/stats/real")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your business</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[120px] rounded-2xl bg-card animate-pulse" style={{ boxShadow: "var(--shadow-card)" }} />
          ))}
        </div>
      </div>
    )
  }

  const statCards = [
    { title: "Orders", value: stats?.totalOrders || 0, icon: ShoppingCart, accent: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
    { title: "Revenue", value: formatBDT(stats?.totalRevenue || 0), icon: DollarSign, accent: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400" },
    { title: "Customers", value: stats?.totalCustomers || 0, icon: Users, accent: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400" },
    { title: "Messages", value: stats?.messagesToday || 0, icon: MessageSquare, accent: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
  ]

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your business</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.title} className="rounded-2xl bg-card p-5 transition-shadow duration-200 hover:shadow-md" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.title}</p>
                <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.accent}`}>
                <stat.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <div className="lg:col-span-5 rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Revenue</h2>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </div>
          {stats?.revenueByDay && stats.revenueByDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.revenueByDay}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatBDT(Number(value))} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "var(--shadow-card-hover)" }} />
                <Bar dataKey="revenue" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-16">No revenue data</p>
          )}
        </div>

        <div className="lg:col-span-2 rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-1 mb-6">
            <h2 className="text-sm font-semibold">Platforms</h2>
            <p className="text-xs text-muted-foreground">Conversation sources</p>
          </div>
          {(() => {
            const pb = stats?.platformBreakdown
            if (!pb) return <p className="text-sm text-muted-foreground">No data</p>
            const entries: [string, number][] = Array.isArray(pb)
              ? pb.map((p: any) => [p.platform || "unknown", p.count || 0])
              : Object.entries(pb)
            if (entries.length === 0) return <p className="text-sm text-muted-foreground">No data</p>
            const total = entries.reduce((sum, [, count]) => sum + count, 0)
            return (
              <div className="space-y-4">
                {entries.map(([platform, count]) => (
                  <div key={platform} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{platform}</span>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
