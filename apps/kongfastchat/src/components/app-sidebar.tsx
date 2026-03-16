import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { MessageSquareIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import {
  createConversation,
  deleteConversation,
  getConversations,
  renameConversation,
} from "../lib/server/conversations"

type Conversation = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export function AppSidebar({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeId = params.conversationId

  const [conversations, setConversations] = useState<Array<Conversation>>([])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  // Delete confirmation state
  const [deletingConversation, setDeletingConversation] = useState<Conversation | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchConversations = useCallback(async () => {
    try {
      const data = await getConversations({ data: { userId } })
      setConversations(data)
    } catch (err) {
      console.error("Failed to fetch conversations:", err)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  const filtered = search
    ? conversations.filter((c) =>
        (c.title ?? "Untitled").toLowerCase().includes(search.toLowerCase()),
      )
    : conversations

  const handleNewChat = async () => {
    try {
      const { id } = await createConversation({
        data: { userId, title: null },
      })
      await fetchConversations()
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } })
    } catch (err) {
      console.error("Failed to create conversation:", err)
    }
  }

  const startRename = (conversation: Conversation) => {
    setEditingId(conversation.id)
    setEditingTitle(conversation.title ?? "")
  }

  const saveRename = async () => {
    if (!editingId || !editingTitle.trim()) {
      setEditingId(null)
      return
    }
    try {
      await renameConversation({
        data: {
          conversationId: editingId,
          userId,
          title: editingTitle.trim(),
        },
      })
      setConversations((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, title: editingTitle.trim() } : c,
        ),
      )
    } catch (err) {
      console.error("Failed to rename conversation:", err)
    } finally {
      setEditingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deletingConversation) return
    setIsDeleting(true)
    try {
      await deleteConversation({
        data: {
          conversationId: deletingConversation.id,
          userId,
        },
      })
      setConversations((prev) =>
        prev.filter((c) => c.id !== deletingConversation.id),
      )
      if (activeId === deletingConversation.id) {
        navigate({ to: "/" })
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err)
    } finally {
      setIsDeleting(false)
      setDeletingConversation(null)
    }
  }

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-semibold">Chats</span>
            <Button variant="ghost" size="icon-xs" onClick={handleNewChat}>
              <PlusIcon />
              <span className="sr-only">New chat</span>
            </Button>
          </div>
          <SidebarInput
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {isLoading ? (
                  <li className="px-4 py-2 text-sm text-muted-foreground">
                    Loading...
                  </li>
                ) : filtered.length === 0 ? (
                  <li className="px-4 py-2 text-sm text-muted-foreground">
                    {search ? "No matches" : "No conversations"}
                  </li>
                ) : (
                  filtered.map((conversation) => (
                    <SidebarMenuItem key={conversation.id}>
                      {editingId === conversation.id ? (
                        <div className="flex items-center gap-1 px-2 py-1">
                          <input
                            ref={editInputRef}
                            className="h-6 w-full rounded border bg-background px-1 text-sm"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRename()
                              if (e.key === "Escape") setEditingId(null)
                            }}
                            onBlur={saveRename}
                          />
                        </div>
                      ) : (
                        <>
                          <SidebarMenuButton
                            isActive={activeId === conversation.id}
                            onClick={() =>
                              navigate({
                                to: "/chat/$conversationId",
                                params: { conversationId: conversation.id },
                              })
                            }
                          >
                            <MessageSquareIcon />
                            <span>{conversation.title ?? "Untitled"}</span>
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            showOnHover
                            onClick={(e) => {
                              e.stopPropagation()
                              startRename(conversation)
                            }}
                            className="right-6"
                          >
                            <PencilIcon />
                            <span className="sr-only">Rename</span>
                          </SidebarMenuAction>
                          <SidebarMenuAction
                            showOnHover
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeletingConversation(conversation)
                            }}
                          >
                            <Trash2Icon />
                            <span className="sr-only">Delete</span>
                          </SidebarMenuAction>
                        </>
                      )}
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <Dialog
        open={!!deletingConversation}
        onOpenChange={(open) => {
          if (!open) setDeletingConversation(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;
              {deletingConversation?.title ?? "Untitled"}&rdquo; and all its
              messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
