import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

function response(body: object, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	window.history.replaceState({}, "", "/");
});

describe("dealer activation", () => {
	it("keeps lookup private until three characters, disambiguates by city, and requests a real OTP", async () => {
		window.history.replaceState({}, "", "/activate");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input.startsWith("/api/activation/dealers")) return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }, { id: "d-2", name: "VLCO", city: "Gaya" }] });
			expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ dealerId: "d-1", email: "pilot@example.test" }) });
			return response({ challengeId: "activation-1" }, 202);
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);

		const lookup = screen.getByLabelText("Find your dealership");
		fireEvent.change(lookup, { target: { value: "VL" } });
		expect(fetchMock).not.toHaveBeenCalled();
		fireEvent.change(lookup, { target: { value: "VLC" } });
		await screen.findByRole("button", { name: "VLCO · Patna" });
		expect(screen.getByRole("button", { name: "VLCO · Gaya" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "VLCO · Patna" }));
		expect(screen.getByText(/Registered email stays private/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Email for this activation"), { target: { value: "pilot@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send code" }));
		await screen.findByText("Enter the 6-digit code");
	});

	it("surfaces provider errors, verifies activation with a password, and keeps keyboard focus in the OTP field", async () => {
		window.history.replaceState({}, "", "/activate");
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input.startsWith("/api/activation/dealers")) return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/request-otp") return response({ challengeId: "activation-1" }, 202);
			return response({ authenticated: true });
		}));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		fireEvent.change(screen.getByLabelText("Email for this activation"), { target: { value: "pilot@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send code" }));
		const otp = await screen.findByLabelText("Verification code");
		expect(otp).toHaveFocus();
		fireEvent.change(otp, { target: { value: "123456" } });
		fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "short-pass" } });
		fireEvent.click(screen.getByRole("button", { name: "Verify and activate" }));
		await waitFor(() => expect(screen.getByText("Your password must be at least 12 characters.")).toBeInTheDocument());
		fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "a-safe-long-password" } });
		fireEvent.click(screen.getByRole("button", { name: "Verify and activate" }));
		await screen.findByText("Activation complete");
	});

	it("offers the registered email masked, sends via emailChoice=MASTER, and lets the dealer switch to an alternate", async () => {
		window.history.replaceState({}, "", "/activate");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/activation/dealers?q=VLC") return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/dealers/d-1") return response({ id: "d-1", name: "VLCO", city: "Patna", maskedMasterEmail: "s****h@vlconsultants.in" });
			if (input === "/api/activation/request-otp") {
				expect(JSON.parse(String(init?.body))).toEqual({ dealerId: "d-1", emailChoice: "MASTER" });
				return response({ challengeId: "activation-1" }, 202);
			}
			throw new Error(`unexpected fetch ${input}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		await screen.findByText("s****h@vlconsultants.in");
		expect(screen.queryByLabelText("Email for this activation")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Send code" }));
		await screen.findByText("Enter the 6-digit code");
	});

	it("falls back to manual email entry when a dealer has no registered email on file", async () => {
		window.history.replaceState({}, "", "/activate");
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input === "/api/activation/dealers?q=VLC") return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/dealers/d-1") return response({ id: "d-1", name: "VLCO", city: "Patna", maskedMasterEmail: null });
			throw new Error(`unexpected fetch ${input}`);
		}));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		await screen.findByLabelText("Email for this activation");
	});
});
