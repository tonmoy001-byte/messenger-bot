"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ExternalLink } from "lucide-react"
import { formatBDT } from "@/lib/utils"

export default function AdsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/ads")
      .then((r) => r.json())
      .then((d) => setData(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  const totalClicks = data.reduce((s, a) => s + (a.clicks || 0), 0)
  const totalRevenue = data.reduce((s, a) => s + (a.revenue || 0), 0)
  const totalOrders = data.reduce((s, a) => s + (a.orders || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
          <p className="text-sm text-muted-foreground">Facebook & Instagram ad performance</p>
        </div>
        <Button variant="outline" onClick={() => window.open("https://business.facebook.com/adsmanager", "_blank")}>
          <ExternalLink className="h-4 w-4 mr-2" />Ads Manager
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Total Clicks", value: totalClicks },
          { label: "Total Orders", value: totalOrders },
          { label: "Total Revenue", value: formatBDT(totalRevenue) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-semibold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="space-y-1 mb-6">
          <h2 className="text-sm font-semibold">Ad Performance</h2>
          <p className="text-xs text-muted-foreground">Individual campaign metrics</p>
        </div>
        {data.length > 0 ? (
          <div className="space-y-3">
            {data.map((ad: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                <div>
                  <p className="font-medium">{ad.campaignName || ad.adName || "Untitled"}</p>
                  <p className="text-sm text-muted-foreground">
                    {ad.platform} · {ad.status}
                    {ad.startDate && ` · Started ${new Date(ad.startDate).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{ad.clicks || 0} clicks</p>
                  <p className="text-sm text-muted-foreground">{ad.conversations || 0} conversations · {formatBDT(ad.revenue || 0)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No ad data yet. Track ad performance in Integrations.
          </p>
        )}
      </div>
    </div>
  )
}
