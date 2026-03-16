import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "./app-sidebar"

const mockNavigate = vi.fn()
const mockConversations = [
  {
    id: "conv-1",
    title: "First chat",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
  },
  {
    id: "conv-2",
    title: "Second chat",
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "conv-3",
    title: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
]

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ conversationId: "conv-1" }),
}))

const mockGetConversations = vi.fn()
const mockCreateConversation = vi.fn()
const mockRenameConversation = vi.fn()
const mockDeleteConversation = vi.fn()

vi.mock("../lib/server/conversations", () => ({
  getConversations: (...args: Array<unknown>) => mockGetConversations(...args),
  createConversation: (...args: Array<unknown>) => mockCreateConversation(...args),
  renameConversation: (...args: Array<unknown>) => mockRenameConversation(...args),
  deleteConversation: (...args: Array<unknown>) => mockDeleteConversation(...args),
}))

// Mock sidebar components to simplify rendering
vi.mock("@workspace/ui/components/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
  SidebarContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input data-testid="search-input" {...props} />
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    onClick,
    isActive,
  }: {
    children: React.ReactNode
    onClick?: () => void
    isActive?: boolean
  }) => (
    <button onClick={onClick} data-active={isActive}>
      {children}
    </button>
  ),
  SidebarMenuAction: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: (e: React.MouseEvent) => void
    showOnHover?: boolean
    className?: string
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
}))

vi.mock("@workspace/ui/components/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogClose: ({
    children,
    asChild,
  }: {
    children: React.ReactNode
    asChild?: boolean
  }) => <>{children}</>,
}))

vi.mock("@workspace/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock("lucide-react", () => ({
  MessageSquareIcon: () => <span data-testid="message-icon" />,
  PencilIcon: () => <span data-testid="pencil-icon" />,
  PlusIcon: () => <span data-testid="plus-icon" />,
  Trash2Icon: () => <span data-testid="trash-icon" />,
}))

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConversations.mockResolvedValue(mockConversations)
  })

  it("renders conversation list", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
      expect(screen.getByText("Second chat")).toBeInTheDocument()
      expect(screen.getByText("Untitled")).toBeInTheDocument()
    })
  })

  it("shows loading state initially", () => {
    mockGetConversations.mockReturnValue(new Promise(() => {}))
    render(<AppSidebar userId="user-1" />)
    expect(screen.getByText("Loading...")).toBeInTheDocument()
  })

  it("filters conversations by search", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "First" },
    })

    expect(screen.getByText("First chat")).toBeInTheDocument()
    expect(screen.queryByText("Second chat")).not.toBeInTheDocument()
  })

  it("shows no matches message when search has no results", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "nonexistent" },
    })

    expect(screen.getByText("No matches")).toBeInTheDocument()
  })

  it("navigates when clicking a conversation", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("Second chat")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Second chat"))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/chat/$conversationId",
      params: { conversationId: "conv-2" },
    })
  })

  it("highlights active conversation", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    const activeButton = screen.getByText("First chat").closest("button")
    expect(activeButton).toHaveAttribute("data-active", "true")
  })

  it("creates new conversation", async () => {
    mockCreateConversation.mockResolvedValue({ id: "new-conv" })
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("New chat"))

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith({
        data: { userId: "user-1", title: null },
      })
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/chat/$conversationId",
        params: { conversationId: "new-conv" },
      })
    })
  })

  it("inline renames a conversation", async () => {
    mockRenameConversation.mockResolvedValue({ id: "conv-1" })
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    // Click the rename button (pencil icon)
    const renameButtons = screen.getAllByText("Rename")
    fireEvent.click(renameButtons[0])

    // Should show edit input
    const editInput = screen.getByDisplayValue("First chat")
    expect(editInput).toBeInTheDocument()

    // Change value and save with Enter
    fireEvent.change(editInput, { target: { value: "Renamed chat" } })
    fireEvent.keyDown(editInput, { key: "Enter" })

    await waitFor(() => {
      expect(mockRenameConversation).toHaveBeenCalledWith({
        data: {
          conversationId: "conv-1",
          userId: "user-1",
          title: "Renamed chat",
        },
      })
    })
  })

  it("shows delete confirmation dialog", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    // Click the delete button (trash icon)
    const deleteButtons = screen.getAllByText("Delete")
    // The first "Delete" from the list item actions
    fireEvent.click(deleteButtons[0])

    // Dialog should appear
    expect(screen.getByTestId("dialog")).toBeInTheDocument()
    expect(screen.getByText("Delete conversation")).toBeInTheDocument()
  })

  it("deletes conversation after confirmation", async () => {
    mockDeleteConversation.mockResolvedValue({ id: "conv-2" })
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("Second chat")).toBeInTheDocument()
    })

    // Click delete on second conversation
    const deleteButtons = screen.getAllByText("Delete")
    fireEvent.click(deleteButtons[1])

    // Confirm deletion in dialog
    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument()
    })

    // The dialog's Delete button (distinct from the list action button)
    const confirmButton = screen.getAllByText("Delete").find(
      (el) => el.closest("[data-testid='dialog']") !== null,
    )
    fireEvent.click(confirmButton!)

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith({
        data: {
          conversationId: "conv-2",
          userId: "user-1",
        },
      })
    })
  })

  it("navigates to home when deleting active conversation", async () => {
    mockDeleteConversation.mockResolvedValue({ id: "conv-1" })
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    // Delete the active conversation (conv-1)
    const deleteButtons = screen.getAllByText("Delete")
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeInTheDocument()
    })

    const confirmButton = screen.getAllByText("Delete").find(
      (el) => el.closest("[data-testid='dialog']") !== null,
    )
    fireEvent.click(confirmButton!)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" })
    })
  })

  it("cancels rename on Escape", async () => {
    render(<AppSidebar userId="user-1" />)

    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })

    const renameButtons = screen.getAllByText("Rename")
    fireEvent.click(renameButtons[0])

    const editInput = screen.getByDisplayValue("First chat")
    fireEvent.keyDown(editInput, { key: "Escape" })

    // Should exit edit mode and show original text
    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument()
    })
    expect(mockRenameConversation).not.toHaveBeenCalled()
  })
})
