import { DollarSign, MessageSquare, ShoppingCart, Users, TrendingUp, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { useQuery } from "@tanstack/react-query"
import { apiService } from "@/services/api"

const Index = () => {
  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ["stats"],
    queryFn: apiService.getStats,
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/5 text-destructive rounded-lg text-sm">
        Error loading statistics. Please check your backend connection.
      </div>
    )
  }

  const { stats, dailyVolume } = dashboardData || { stats: {}, dailyVolume: [] }

  const statCards = [
    { title: "Total Orders", value: stats.orders?.value || 0, change: stats.orders?.change || "0%", up: stats.orders?.up ?? true, icon: ShoppingCart },
    { title: "Total Revenue", value: `$${stats.revenue?.value || 0}`, change: stats.revenue?.change || "0%", up: stats.revenue?.up ?? true, icon: DollarSign },
    { title: "Total Customers", value: stats.customers?.value || 0, change: stats.customers?.change || "0%", up: stats.customers?.up ?? true, icon: Users },
    { title: "Total Messages", value: stats.messages?.value || 0, change: stats.messages?.change || "0%", up: stats.messages?.up ?? true, icon: MessageSquare },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your automation platform</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.title} className="border-border/50 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.title}</p>
                  <p className="text-2xl font-semibold tracking-tight">{s.value}</p>
                  <div className="flex items-center gap-1 text-xs">
                    {s.up ? (
                      <ArrowUpRight className="h-3 w-3 text-success" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 text-destructive" />
                    )}
                    <span className={s.up ? "text-success" : "text-destructive"}>{s.change}</span>
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                  <s.icon className="h-4 w-4 text-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4 border-border/50 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Daily Message Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={dailyVolume}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                <XAxis dataKey="day" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Line type="monotone" dataKey="messages" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: "hsl(var(--foreground))" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3 border-border/50 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center h-[240px]">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Conversation to Order</p>
              <p className="text-5xl font-semibold tracking-tight">{stats.conversionRate?.value || "0%"}</p>
              <p className="text-xs text-success mt-3 flex items-center justify-center gap-1">
                <TrendingUp className="h-3 w-3" /> {stats.conversionRate?.change || "0%"} increase
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: "Messenger Bot", status: "Online" },
              { name: "WhatsApp API", status: "Online" },
              { name: "Gemini AI Model", status: "Active" },
              { name: "Database (MongoDB)", status: "Connected" },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50">
                <span className="text-sm">{item.name}</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Index
