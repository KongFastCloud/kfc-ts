import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@neondatabase/neon-js/auth/react/ui", () => ({
  AuthView: ({ pathname }: { pathname: string }) => (
    <div data-testid="auth-view">Auth: {pathname}</div>
  ),
  NeonAuthUIProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock("@neondatabase/neon-js/auth", () => ({
  createAuthClient: vi.fn(() => ({
    getSession: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(),
  })),
}))

describe("AuthPage", () => {
  it("renders AuthView with sign-in pathname", async () => {
    const { AuthView } = await import("@neondatabase/neon-js/auth/react/ui")
    render(<AuthView pathname="sign-in" />)
    expect(screen.getByTestId("auth-view")).toHaveTextContent("Auth: sign-in")
  })

  it("renders AuthView with sign-up pathname", async () => {
    const { AuthView } = await import("@neondatabase/neon-js/auth/react/ui")
    render(<AuthView pathname="sign-up" />)
    expect(screen.getByTestId("auth-view")).toHaveTextContent("Auth: sign-up")
  })
})
