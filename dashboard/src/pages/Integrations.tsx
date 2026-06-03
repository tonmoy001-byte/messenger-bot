import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiService } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, Check, Link2 } from "lucide-react"
import { toast } from "sonner"

export default function Integrations() {
  const queryClient = useQueryClient()
  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: apiService.getIntegrations,
  })

  const [shopifyUrl, setShopifyUrl] = useState("")
  const [shopifyToken, setShopifyToken] = useState("")
  const [wooUrl, setWooUrl] = useState("")
  const [wooKey, setWooKey] = useState("")
  const [wooSecret, setWooSecret] = useState("")

  const connectMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: any }) => apiService.updateIntegration(type, data),
    onSuccess: () => {
      toast.success("Integration connected")
      queryClient.invalidateQueries({ queryKey: ["integrations"] })
    },
    onError: () => toast.error("Failed to connect"),
  })

  if (isLoading) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect your e-commerce platforms</p>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">Shopify</CardTitle>
              <CardDescription>Connect your Shopify store</CardDescription>
            </div>
            <Badge variant={integrations?.shopify?.connected ? "default" : "outline"}>
              {integrations?.shopify?.connected ? <><Check className="h-3 w-3 mr-1" /> Connected</> : "Not Connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Store URL</Label>
            <Input placeholder="your-store.myshopify.com" value={shopifyUrl} onChange={(e) => setShopifyUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Admin API Token</Label>
            <Input type="password" placeholder="shpat_..." value={shopifyToken} onChange={(e) => setShopifyToken(e.target.value)} />
          </div>
          <Button onClick={() => connectMutation.mutate({ type: "shopify", data: { storeUrl: shopifyUrl, accessToken: shopifyToken } })} disabled={connectMutation.isPending || !shopifyUrl || !shopifyToken}>
            {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
            Connect Shopify
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">WooCommerce</CardTitle>
              <CardDescription>Connect your WooCommerce store</CardDescription>
            </div>
            <Badge variant={integrations?.woocommerce?.connected ? "default" : "outline"}>
              {integrations?.woocommerce?.connected ? <><Check className="h-3 w-3 mr-1" /> Connected</> : "Not Connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Store URL</Label>
            <Input placeholder="https://your-store.com" value={wooUrl} onChange={(e) => setWooUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Consumer Key</Label>
              <Input type="password" placeholder="ck_..." value={wooKey} onChange={(e) => setWooKey(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Consumer Secret</Label>
              <Input type="password" placeholder="cs_..." value={wooSecret} onChange={(e) => setWooSecret(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => connectMutation.mutate({ type: "woocommerce", data: { storeUrl: wooUrl, consumerKey: wooKey, consumerSecret: wooSecret } })} disabled={connectMutation.isPending || !wooUrl || !wooKey || !wooSecret}>
            {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
            Connect WooCommerce
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
