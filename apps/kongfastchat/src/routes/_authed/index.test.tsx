import { describe, expect, it, vi } from "vitest"

vi.mock("@workspace/db/client", () => ({
  db: {},
}))

vi.mock("@neondatabase/neon-js/auth", () => ({
  createAuthClient: vi.fn(() => mockAuthClient),
}))

const mockAuthClient = {
  getSession: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
  signIn: { social: vi.fn() },
}

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router")
  return {
    ...actual,
    redirect: vi.fn((opts) => {
      throw { __isRedirect: true, ...opts }
    }),
  }
})

describe("_authed layout beforeLoad", () => {
  it("redirects to sign-in when no session exists", async () => {
    mockAuthClient.getSession.mockResolvedValue({ data: null })

    const { Route } = await import("../_authed")
    const beforeLoad = (Route.options as { beforeLoad?: () => Promise<unknown> })
      .beforeLoad

    await expect(beforeLoad!()).rejects.toMatchObject({
      __isRedirect: true,
      to: "/auth/$pathname",
      params: { pathname: "sign-in" },
    })
  })

  it("returns session when user is authenticated", async () => {
    const mockSession = {
      user: { id: "1", name: "Test", email: "test@example.com" },
    }
    mockAuthClient.getSession.mockResolvedValue({ data: mockSession })

    const { Route } = await import("../_authed")
    const beforeLoad = (Route.options as { beforeLoad?: () => Promise<unknown> })
      .beforeLoad

    const result = await beforeLoad!()
    expect(result).toEqual({ session: mockSession })
  })
})
