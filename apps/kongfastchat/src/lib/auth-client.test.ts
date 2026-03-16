import { describe, expect, it, vi } from "vitest"

vi.mock("@neondatabase/neon-js/auth", () => ({
  createAuthClient: vi.fn((url: string) => ({
    url,
    getSession: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(),
    signIn: { social: vi.fn() },
  })),
}))

describe("auth-client", () => {
  it("creates auth client with VITE_NEON_AUTH_URL", async () => {
    const { createAuthClient } = await import("@neondatabase/neon-js/auth")
    const { authClient } = await import("./auth-client")

    expect(createAuthClient).toHaveBeenCalled()
    expect(authClient).toBeDefined()
    expect(authClient.getSession).toBeDefined()
    expect(authClient.signOut).toBeDefined()
  })
})
