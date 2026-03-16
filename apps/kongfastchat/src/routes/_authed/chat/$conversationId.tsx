import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "../../../lib/auth-client"
import { readDataStream } from "../../../lib/data-stream"
import { getMessages } from "../../../lib/server/conversations"
import { sendMessage } from "../../../lib/server/chat"

type Message = {
  id: string
  role: "user" | "assistant" | "system"
  content: { text: string }
}

export const Route = createFileRoute("/_authed/chat/$conversationId")({
  component: ChatPage,
})

function ChatPage() {
  const { data: session } = authClient.useSession()
  const { conversationId } = Route.useParams()

  const [messages, setMessages] = useState<Array<Message>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!session?.user) return
    setIsLoading(true)
    getMessages({
      data: {
        conversationId,
        userId: session.user.id,
      },
    })
      .then((msgs) => setMessages(msgs as Array<Message>))
      .catch((err) => console.error("Failed to load messages:", err))
      .finally(() => setIsLoading(false))
  }, [conversationId, session?.user])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText, scrollToBottom])

  if (!session?.user) return null

  const handleSend = async () => {
    const content = input.trim()
    if (!content || isStreaming) return

    setInput("")
    setIsStreaming(true)
    setStreamingText("")

    const tempUserMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: { text: content },
    }
    setMessages((prev) => [...prev, tempUserMsg])

    try {
      const response = await sendMessage({
        data: {
          conversationId,
          userId: session.user.id,
          content,
        },
      })

      if (response instanceof Response && response.body) {
        await readDataStream(response.body, (token) => {
          setStreamingText((prev) => prev + token)
        })
      }
    } catch (err) {
      console.error("Failed to send message:", err)
    } finally {
      setStreamingText((prev) => {
        if (prev) {
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: { text: prev },
          }
          setMessages((msgs) => [...msgs, assistantMsg])
        }
        return ""
      })
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {isLoading ? (
            <p className="text-center text-sm text-muted-foreground">Loading messages...</p>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} role={msg.role} text={msg.content.text} />
              ))}
              {streamingText && (
                <MessageBubble role="assistant" text={streamingText} />
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for newline)"
            rows={1}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isStreaming}
          />
          <Button onClick={handleSend} disabled={isStreaming || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, text }: { role: string; text: string }) {
  const isUser = role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {text}
      </div>
    </div>
  )
}
