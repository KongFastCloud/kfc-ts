import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "../../lib/auth-client"
import { createConversation } from "../../lib/server/conversations"

export const Route = createFileRoute("/_authed/")({
  component: App,
})

function App() {
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)

  if (!session?.user) return null

  const handleNewChat = async () => {
    setIsCreating(true)
    try {
      const { id } = await createConversation({
        data: { userId: session.user.id, title: null },
      })
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } })
    } catch (err) {
      console.error("Failed to create conversation:", err)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-medium">
        Welcome, {session.user.name || session.user.email}
      </h1>
      <p className="text-sm text-muted-foreground">
        Select a conversation from the sidebar or start a new one.
      </p>
      <div className="flex gap-2">
        <Button onClick={handleNewChat} disabled={isCreating}>
          {isCreating ? "Creating..." : "New chat"}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await authClient.signOut()
            window.location.href = "/auth/sign-in"
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  )
}
