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
	it("sends an email-only login OTP and makes resend countdown visible", async () => {
		window.history.replaceState({}, "", "/login");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/login/otp") {
				expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ email: "dealer@example.test" }) });
				return response({ challengeId: "login-1" }, 202);
			}
			if (input === "/api/otp/resend") return response({ challengeId: "login-2" }, 202);
			return response({ authenticated: true, role: "DEALER" });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);
		fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "dealer@example.test" } });
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
		await screen.findByText("Enter your code.");
		expect(screen.getByText(/You can ask for a new code in/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "Confirm and sign in" }));
		await screen.findByRole("tablist", { name: "Catalogue sections" });
	});

	it("shows a precise delivery failure without suggesting the account was found", async () => {
		window.history.replaceState({}, "", "/login");
		vi.stubGlobal("fetch", vi.fn(async () => response({ error: "EMAIL_DELIVERY_FAILED" }, 502)));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "dealer@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
		await screen.findByText("We could not send your verification code. Try again shortly.");
	});
});
