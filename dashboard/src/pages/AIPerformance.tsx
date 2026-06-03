import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Brain, ThumbsUp, ShoppingCart, AlertTriangle } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"]

export default function AIPerformance() {
  const [days, setDays] = useState("7")

  const { data: performance, isLoading: perfLoading } = useQuery({
    queryKey: ["aiPerformance", days],
    queryFn: () => apiService.getAIPerformance(parseInt(days)),
  })

  const { data: feedbackStats, isLoading: fbLoading } = useQuery({
    queryKey: ["feedbackStats", days],
    queryFn: () => apiService.getFeedbackStats(parseInt(days)),
  })

  if (perfLoading || fbLoading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>
  }

  const ratingDistribution = feedbackStats?.distribution
    ? Object.entries(feedbackStats.distribution).map(([rating, count]) => ({ rating: `${rating}★`, count: count as number }))
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI Performance</h1>
          <p className="text-sm text-muted-foreground">Track AI automation and ratings</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Automation Rate</p>
              <Brain className="h-4 w-4 text-foreground" />
            </div>
            <p className="text-2xl font-semibold">{performance?.automationRate || 0}%</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Rating</p>
              <ThumbsUp className="h-4 w-4 text-foreground" />
            </div>
            <p className="text-2xl font-semibold">{performance?.avgRating || 0}/5</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Orders</p>
              <ShoppingCart className="h-4 w-4 text-foreground" />
            </div>
            <p className="text-2xl font-semibold">{performance?.orders || 0}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Handoffs</p>
              <AlertTriangle className="h-4 w-4 text-foreground" />
            </div>
            <p className="text-2xl font-semibold">{performance?.handoffs || 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Rating Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {ratingDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ratingDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                <XAxis dataKey="rating" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {ratingDistribution.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">No ratings yet</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
