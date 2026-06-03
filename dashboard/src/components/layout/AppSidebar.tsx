import { LayoutDashboard, MessageSquare, Users, ShoppingCart, BarChart3, Settings, Share2, Brain, Bot, Megaphone } from "lucide-react"
import { NavLink } from "react-router-dom"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar"

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Conversations", url: "/conversations", icon: MessageSquare },
  { title: "Integrations", url: "/integrations", icon: Share2 },
  { title: "Knowledge Base", url: "/knowledge", icon: Brain },
  { title: "AI Performance", url: "/ai-performance", icon: Bot },
  { title: "Ads", url: "/ads", icon: Megaphone },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Orders", url: "/orders", icon: ShoppingCart },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Settings", url: "/settings", icon: Settings },
]

export function AppSidebar() {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground">
            <span className="text-xs font-semibold text-background">A</span>
          </div>
          {!collapsed && <span className="text-sm font-semibold tracking-tight">AutoFlow</span>}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2">Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={false} className="h-9 rounded-md data-[active=true]:bg-foreground data-[active=true]:text-background hover:bg-secondary">
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={({ isActive }) => `gap-3 ${isActive ? "bg-foreground text-background" : ""}`}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
