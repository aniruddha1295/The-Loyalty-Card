// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Providers, PRIVY_CONFIG } from "@/app/providers";
import { LoyaltyShell, SUPPORTED_LOGIN_METHODS } from "@/components/LoyaltyShell";

const privyMock = vi.hoisted(() => ({
  usePrivy: vi.fn(),
  PrivyProvider: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => privyMock);

afterEach(() => {
  cleanup();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME_JSON = {
  userId: "did:privy:abc123",
  email: "mina@example.com",
  displayName: "Mina",
  walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
  balance: 3,
  stampCount: 3,
  staff: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  freeLoafThreshold: 10,
};

describe("LoyaltyShell — Privy-state machine", () => {
  it("P7-4 shows an initialization screen while Privy is not ready", () => {
    privyMock.usePrivy.mockReturnValue({ ready: false, authenticated: false, login: vi.fn() });
    render(<LoyaltyShell />);
    expect(screen.getByText(/Loading your loyalty card/i)).toBeInTheDocument();
    expect(screen.queryByTestId("signin-button")).toBeNull();
  });

  it("P7-1 + P7-3 when authenticated=false shows the real Privy login UI with configured login methods", () => {
    const login = vi.fn();
    privyMock.usePrivy.mockReturnValue({ ready: true, authenticated: false, login });

    render(<LoyaltyShell />);

    const button = screen.getByTestId("signin-button");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ loginMethods: [...SUPPORTED_LOGIN_METHODS] });
    expect(screen.queryByTestId("stamp-count")).toBeNull();
  });

  it("P7-3 hides the dashboard entirely until the user is authenticated", () => {
    privyMock.usePrivy.mockReturnValue({ ready: true, authenticated: false, login: vi.fn() });
    render(<LoyaltyShell />);
    expect(screen.queryByTestId("customer-email")).toBeNull();
    expect(screen.queryByTestId("stamp-count")).toBeNull();
    expect(screen.getByTestId("signin-button")).toBeInTheDocument();
  });
});

describe("Providers — automatic embedded wallet on login", () => {
  it("P7-2 configures createOnLogin='users-without-wallets'", () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app_test_123");

    expect(PRIVY_CONFIG.embeddedWallets.ethereum.createOnLogin).toBe("users-without-wallets");

    render(
      <Providers>
        <div data-testid="child" />
      </Providers>,
    );

    const props = privyMock.PrivyProvider.mock.calls[0][0] as {
      appId: string;
      config: { embeddedWallets: { ethereum: { createOnLogin: string } } };
    };
    expect(privyMock.PrivyProvider).toHaveBeenCalled();
    expect(props.appId).toBe("app_test_123");
    expect(props.config.embeddedWallets.ethereum.createOnLogin).toBe("users-without-wallets");
  });
});

describe("LoyaltyDashboard — access tokens go to the server as Bearer credentials", () => {
  it("P7-7 /api/me and /api/stamps/award are called with Authorization: Bearer <access token>", async () => {
    privyMock.usePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      user: { id: "did:privy:abc123" },
      getAccessToken: async () => "test-access-token",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return jsonResponse(ME_JSON);
      if (url.endsWith("/api/stamps/award")) {
        return jsonResponse({
          mode: "customer-self",
          balance: 4,
          customer: { userId: "did:privy:abc123", balance: 4, createdAt: "2026-01-01T00:00:00.000Z" },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoyaltyShell />);

    await screen.findByTestId("stamp-count");
    const meCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/me"));
    expect(meCall).toBeDefined();
    expect((meCall![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-access-token",
    });

    fireEvent.click(screen.getByRole("button", { name: /add stamp/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/stamps/award"))).toBe(
        true,
      ),
    );

    const awardCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/stamps/award"));
    expect((awardCall![1] as RequestInit).method).toBe("POST");
    expect((awardCall![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-access-token",
    });
  });
});

describe("LoyaltyDashboard — completed card state at 10 stamps", () => {
  it("shows a Card complete state and removes Add Stamp and counter check-in actions", async () => {
    privyMock.usePrivy.mockReturnValue({
      ready: true,
      authenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      user: { id: "did:privy:abc123" },
      getAccessToken: async () => "test-access-token",
    });

    const completeMe = { ...ME_JSON, balance: 10, stampCount: 10 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return jsonResponse(completeMe);
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoyaltyShell />);

    await screen.findByTestId("stamp-count");
    expect(screen.getByText("10 of 10 stamps")).toBeInTheDocument();
    expect(screen.getByTestId("card-complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add stamp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /check in at the counter/i })).toBeNull();
  });
});