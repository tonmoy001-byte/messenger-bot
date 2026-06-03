import { useState } from "react"
import { Search, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useQuery } from "@tanstack/react-query"
import { apiService } from "@/services/api"

export default function Orders() {
  const [search, setSearch] = useState("")
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: apiService.getOrders,
  })

  const filtered = orders.filter((o: any) =>
    o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
    o.orderId?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">Track and manage customer orders</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search orders..." className="pl-8 h-8 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="border rounded-lg">
        <ScrollArea className="h-[calc(100vh-12rem)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No orders found</TableCell></TableRow>
              ) : (
                filtered.map((o: any) => (
                  <TableRow key={o._id}>
                    <TableCell className="font-mono text-xs">{o.orderId || o._id?.slice(-8)}</TableCell>
                    <TableCell className="text-sm">{o.customerName || "-"}</TableCell>
                    <TableCell className="text-sm">{o.items?.length || 1} item(s)</TableCell>
                    <TableCell className="text-sm font-medium">৳{(o.totalAmount || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={o.status === "completed" ? "default" : o.status === "pending" ? "secondary" : "outline"} className="capitalize">
                        {o.status || "pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.timestamp || o.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  )
}
