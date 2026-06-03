import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bell, Moon, Search, Sun, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function Header() {
  const [dark, setDark] = useState(false)
  const navigate = useNavigate()
  const adminUsername = localStorage.getItem("admin_username") || "admin"

  const toggleTheme = () => {
    setDark(!dark)
    document.documentElement.classList.toggle("dark")
  }

  const onLogout = () => {
    localStorage.removeItem("admin_token")
    localStorage.removeItem("admin_username")
    navigate("/login")
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search..." className="pl-9 h-8 border-0 bg-secondary/50 focus-visible:ring-0 focus-visible:bg-secondary" />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={toggleTheme}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-3 border-b">
              <h4 className="font-medium text-sm">Notifications</h4>
            </div>
            <div className="p-3 text-sm text-muted-foreground">No new notifications</div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Avatar className="h-7 w-7 cursor-pointer">
              <AvatarFallback className="bg-foreground text-background text-xs font-medium">
                {adminUsername.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="end">
            <div className="px-2 py-1.5 border-b mb-1">
              <p className="text-sm font-medium">{adminUsername}</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive h-8"
              onClick={onLogout}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Logout
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
