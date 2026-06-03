import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Loader2, Plus, Pause, Play, Trash2, MousePointer, ShoppingCart, DollarSign, Target } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { toast } from "sonner"

export default function AdManagement() {
  const queryClient = useQueryClient()
  const [days, setDays] = useState("30")
  const [showDialog, setShowDialog] = useState(false)
  const [newAd, setNewAd] = useState({ adId: "", campaignId: "", campaignName: "", adName: "", platform: "facebook", costPerClick: "" })

  const { data: adPerformance, isLoading: perfLoading } = useQuery({
    queryKey: ["adPerformance", days],
    queryFn: () => apiService.getAdPerformance(parseInt(days)),
  })

  const { data: adStats, isLoading: statsLoading } = useQuery({
    queryKey: ["adStats", days],
    queryFn: () => apiService.getAdStats(parseInt(days)),
  })

  const createMutation = useMutation({
    mutationFn: apiService.createOrUpdateAd,
    onSuccess: () => {
      toast.success("Ad created")
      setShowDialog(false)
      setNewAd({ adId: "", campaignId: "", campaignName: "", adName: "", platform: "facebook", costPerClick: "" })
      queryClient.invalidateQueries({ queryKey: ["adPerformance"] })
    },
    onError: () => toast.error("Failed to create ad"),
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ adId, status }: { adId: string; status: string }) => apiService.updateAdStatus(adId, status),
    onSuccess: () => {
      toast.success("Status updated")
      queryClient.invalidateQueries({ queryKey: ["adPerformance"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: apiService.deleteAd,
    onSuccess: () => {
      toast.success("Ad deleted")
      queryClient.invalidateQueries({ queryKey: ["adPerformance"] })
    },
  })

  const chartData = adPerformance?.map((ad: any) => ({
    name: ad.adName || ad.adId.slice(-6),
    clicks: ad.clicks,
    conversations: ad.conversations,
    orders: ad.orders,
  })) || []

  if (perfLoading || statsLoading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Ads</h1>
          <p className="text-sm text-muted-foreground">Track ad campaign performance</p>
        </div>
        <div className="flex gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Ad</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New Ad</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Ad ID *</Label><Input value={newAd.adId} onChange={(e) => setNewAd({ ...newAd, adId: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Campaign ID *</Label><Input value={newAd.campaignId} onChange={(e) => setNewAd({ ...newAd, campaignId: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Campaign Name</Label><Input value={newAd.campaignName} onChange={(e) => setNewAd({ ...newAd, campaignName: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Ad Name</Label><Input value={newAd.adName} onChange={(e) => setNewAd({ ...newAd, adName: e.target.value })} /></div>
                  <div className="space-y-2">
                    <Label>Platform</Label>
                    <Select value={newAd.platform} onValueChange={(v) => setNewAd({ ...newAd, platform: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="facebook">Facebook</SelectItem><SelectItem value="instagram">Instagram</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate({ ...newAd, costPerClick: parseFloat(newAd.costPerClick) || 0 })} disabled={createMutation.isPending || !newAd.adId || !newAd.campaignId}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/50 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between mb-2"><p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Ads</p><Target className="h-4 w-4" /></div><p className="text-2xl font-semibold">{adStats?.totalAds || 0}</p></CardContent></Card>
        <Card className="border-border/50 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between mb-2"><p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Clicks</p><MousePointer className="h-4 w-4" /></div><p className="text-2xl font-semibold">{adStats?.totalClicks || 0}</p></CardContent></Card>
        <Card className="border-border/50 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between mb-2"><p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversions</p><ShoppingCart className="h-4 w-4" /></div><p className="text-2xl font-semibold">{adStats?.totalConversions || 0}</p></CardContent></Card>
        <Card className="border-border/50 shadow-none"><CardContent className="p-5"><div className="flex items-center justify-between mb-2"><p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Revenue</p><DollarSign className="h-4 w-4" /></div><p className="text-2xl font-semibold">৳{(adStats?.totalRevenue || 0).toLocaleString()}</p></CardContent></Card>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Performance Overview</CardTitle></CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="clicks" fill="#09090b" name="Clicks" radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversations" fill="#71717a" name="Conversations" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" fill="#a1a1aa" name="Orders" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">No ad data yet</div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Campaigns</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adPerformance?.length > 0 ? adPerformance.map((ad: any) => (
                <TableRow key={ad.adId}>
                  <TableCell className="font-medium">{ad.adName || ad.adId.slice(-8)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{ad.campaignName || "-"}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{ad.platform}</Badge></TableCell>
                  <TableCell className="text-right">{ad.clicks}</TableCell>
                  <TableCell className="text-right">{ad.orders}</TableCell>
                  <TableCell className="text-right font-medium">৳{ad.revenue?.toLocaleString() || 0}</TableCell>
                  <TableCell><Badge variant={ad.status === "active" ? "default" : "outline"} className="capitalize">{ad.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateStatusMutation.mutate({ adId: ad.adId, status: ad.status === "active" ? "paused" : "active" })}>
                        {ad.status === "active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(ad.adId)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No ads tracked yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
