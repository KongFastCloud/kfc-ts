import { Outlet, createFileRoute } from "@tanstack/react-router"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { SignedIn, SignedOut, AuthLoading, RedirectToSignIn } from "@neondatabase/neon-js/auth/react/ui"
import { authClient } from "../lib/auth-client"
import { AppSidebar } from "../components/app-sidebar"

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
})

function AuthedLayout() {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </AuthLoading>
      <SignedIn>
        <AuthedContent />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

function AuthedContent() {
  const { data: session } = authClient.useSession()

  if (!session?.user) return null

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar userId={session.user.id} />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
