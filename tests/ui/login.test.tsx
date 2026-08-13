import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

function response(body: object, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	window.history.replaceState({}, "", "/");
});

describe("dealer login", () => {
	it("uses password then a fresh login OTP and makes resend countdown visible", async () => {
		window.history.replaceState({}, "", "/login");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/login/password") {
				expect(init).toMatchObject({ method: "POST", credentials: "include" });
				return response({ challengeId: "login-1" }, 202);
			}
			if (input === "/api/otp/resend") return response({ challengeId: "login-2" }, 202);
			return response({ authenticated: true });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dealer@example.test" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-safe-password" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await screen.findByText("Confirm your sign-in");
		expect(screen.getByText(/Resend available in/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "Confirm sign-in" }));
		await screen.findByText("Browse your next collection.");
	});

	it("shows a precise delivery failure without suggesting that credentials were accepted", async () => {
		window.history.replaceState({}, "", "/login");
		vi.stubGlobal("fetch", vi.fn(async () => response({ error: "EMAIL_DELIVERY_FAILED" }, 502)));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dealer@example.test" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-safe-password" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await screen.findByText("We could not send your verification code. Try again shortly.");
	});
});
