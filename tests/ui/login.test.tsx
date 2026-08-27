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

describe("dealer login (Dealer Code + password, no OTP)", () => {
	it("signs in an already-active dealer straight through, with no OTP step", async () => {
		window.history.replaceState({}, "", "/login");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/login") {
				expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ identifier: "BIHAR-0001", password: "correct horse battery" }) });
				return response({ authenticated: true, role: "DEALER", mustChangePassword: false });
			}
			return response({ lines: [] });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);

		fireEvent.change(screen.getByLabelText("Email or Dealer Code"), { target: { value: "BIHAR-0001" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await screen.findByRole("tablist", { name: "Catalogue sections" });
	});

	it("forces a password change on first login before the dealer reaches the catalogue", async () => {
		// The password KITCO issued must never remain valid past the first sign-in --
		// otherwise it sits in whatever channel it was handed over on indefinitely.
		window.history.replaceState({}, "", "/login");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/login") return response({ authenticated: true, role: "DEALER", mustChangePassword: true });
			if (input === "/api/login/password") {
				expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ password: "a-brand-new-password" }) });
				return response({ authenticated: true, role: "DEALER" });
			}
			return response({ lines: [] });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);

		fireEvent.change(screen.getByLabelText("Email or Dealer Code"), { target: { value: "BIHAR-0001" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "kitco-issued-temp" } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		await screen.findByText("Choose your password.");
		const newPassword = screen.getByLabelText("New password");
		const save = screen.getByRole("button", { name: "Save and continue" });
		expect(save).toBeDisabled();
		fireEvent.change(newPassword, { target: { value: "short" } });
		expect(save).toBeDisabled();
		fireEvent.change(newPassword, { target: { value: "a-brand-new-password" } });
		expect(save).not.toBeDisabled();
		fireEvent.click(save);
		await screen.findByRole("tablist", { name: "Catalogue sections" });
	});

	it("gives the identical answer for a wrong password and an unknown Dealer Code", async () => {
		window.history.replaceState({}, "", "/login");
		vi.stubGlobal("fetch", vi.fn(async () => response({ error: "INVALID_CREDENTIALS" }, 401)));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Email or Dealer Code"), { target: { value: "NOT-A-REAL-CODE" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever" } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await screen.findByText(/Those sign-in details are incorrect/);
	});

	it("disables Sign in the instant it is pressed, so a double-tap cannot fire two requests", async () => {
		window.history.replaceState({}, "", "/login");
		let resolveLogin: (value: Response) => void = () => undefined;
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveLogin = resolve; })));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Email or Dealer Code"), { target: { value: "BIHAR-0001" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
		const signIn = screen.getByRole("button", { name: "Sign in" });
		fireEvent.click(signIn);
		expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
		resolveLogin(response({ authenticated: true, role: "DEALER", mustChangePassword: false }));
		await screen.findByRole("tablist", { name: "Catalogue sections" });
	});

	it("routes a forgotten-password request through the OTP screen, revealing nothing about whether the account exists", async () => {
		window.history.replaceState({}, "", "/login");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/login/reset") {
				expect(init).toMatchObject({ body: JSON.stringify({ identifier: "nobody@example.test" }) });
				return response({ challengeId: "reset-1" }, 202);
			}
			if (input === "/api/otp/verify") {
				expect(init).toMatchObject({ body: JSON.stringify({ challengeId: "reset-1", code: "123456", purpose: "PASSWORD_RESET" }) });
				return response({ authenticated: false, passwordResetAuthorised: true });
			}
			return response({});
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "I've forgotten my password" }));
		fireEvent.change(screen.getByLabelText("Email or Dealer Code"), { target: { value: "nobody@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
		await screen.findByText("Enter your code.");

		fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
		await screen.findByText("Choose your password.");
		expect(screen.getByText(/Pick a new password/)).toBeInTheDocument();
	});
});
