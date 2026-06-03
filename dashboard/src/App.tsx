import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Toaster } from "@/components/ui/sonner"
import Login from "./pages/Login"
import Index from "./pages/Index"
import Conversations from "./pages/Conversations"
import Customers from "./pages/Customers"
import Orders from "./pages/Orders"
import Analytics from "./pages/Analytics"
import Settings from "./pages/Settings"
import Integrations from "./pages/Integrations"
import KnowledgeBase from "./pages/KnowledgeBase"
import AIPerformance from "./pages/AIPerformance"
import AdManagement from "./pages/AdManagement"
import NotFound from "./pages/NotFound"

const queryClient = new QueryClient()

const isAuthenticated = () => !!localStorage.getItem("admin_token")

const AuthCheck = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuth, setIsAuth] = useState(false)

  useEffect(() => {
    setIsAuth(isAuthenticated())
    setIsLoading(false)
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuth) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <AuthCheck>
              <DashboardLayout>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/conversations" element={<Conversations />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/knowledge" element={<KnowledgeBase />} />
                  <Route path="/ai-performance" element={<AIPerformance />} />
                  <Route path="/ads" element={<AdManagement />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </DashboardLayout>
            </AuthCheck>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  </QueryClientProvider>
)

export default App
