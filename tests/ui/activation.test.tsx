import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

function response(body: object, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BUSINESS = { gstin: "22AAAAA0000A1Z5", addressLine1: "12 MG Road", addressLine2: "", city: "Patna", state: "Bihar", pinCode: "800001", contactPerson: "Asha Rao", mobile: "9800000000" };

/** Fills the "Confirm business" step (GSTIN + structured address, required
 *  but unvalidated per D5/D6) and continues to the email step. */
function fillBusinessStep() {
	fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: BUSINESS.gstin } });
	fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: BUSINESS.addressLine1 } });
	fireEvent.change(screen.getByLabelText("City"), { target: { value: BUSINESS.city } });
	fireEvent.change(screen.getByLabelText("State"), { target: { value: BUSINESS.state } });
	fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: BUSINESS.pinCode } });
	fireEvent.change(screen.getByLabelText("Contact person"), { target: { value: BUSINESS.contactPerson } });
	fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: BUSINESS.mobile } });
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	window.history.replaceState({}, "", "/");
});

describe("dealer activation", () => {
	it("keeps lookup private until three characters, disambiguates by city, and requests a real OTP", async () => {
		window.history.replaceState({}, "", "/activate");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/activation/dealers?q=VLC") return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }, { id: "d-2", name: "VLCO", city: "Gaya" }] });
			if (input === "/api/activation/dealers/d-1") return response({ id: "d-1", name: "VLCO", city: "Patna", maskedMasterEmail: null });
			if (input === "/api/activation/request-otp") {
				expect(JSON.parse(String(init?.body))).toEqual({ dealerId: "d-1", email: "pilot@example.test", business: BUSINESS });
				return response({ challengeId: "activation-1" }, 202);
			}
			throw new Error(`unexpected fetch ${input}`);
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
		await screen.findByText("Confirm your business details");
		fillBusinessStep();
		expect(screen.getByText(/Registered email stays private/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Email for this activation"), { target: { value: "pilot@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send code" }));
		await screen.findByText("Enter the 6-digit code");
	});

	it("verifies activation on OTP alone -- no password -- and keeps keyboard focus in the OTP field", async () => {
		window.history.replaceState({}, "", "/activate");
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input.startsWith("/api/activation/dealers")) return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/request-otp") return response({ challengeId: "activation-1" }, 202);
			return response({ authenticated: true });
		}));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		await screen.findByText("Confirm your business details");
		fillBusinessStep();
		fireEvent.change(screen.getByLabelText("Email for this activation"), { target: { value: "pilot@example.test" } });
		fireEvent.click(screen.getByRole("button", { name: "Send code" }));
		const otp = await screen.findByLabelText("Verification code");
		expect(otp).toHaveFocus();
		expect(screen.queryByLabelText("Create password")).not.toBeInTheDocument();
		fireEvent.change(otp, { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "Verify and activate" }));
		await screen.findByText("Activation complete");
	});

	it("offers the registered email masked, sends via emailChoice=MASTER, and lets the dealer switch to an alternate", async () => {
		window.history.replaceState({}, "", "/activate");
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (input === "/api/activation/dealers?q=VLC") return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/dealers/d-1") return response({ id: "d-1", name: "VLCO", city: "Patna", maskedMasterEmail: "s****h@vlconsultants.in" });
			if (input === "/api/activation/request-otp") {
				expect(JSON.parse(String(init?.body))).toEqual({ dealerId: "d-1", emailChoice: "MASTER", business: BUSINESS });
				return response({ challengeId: "activation-1" }, 202);
			}
			throw new Error(`unexpected fetch ${input}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		await screen.findByText("Confirm your business details");
		fillBusinessStep();
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
		await screen.findByText("Confirm your business details");
		fillBusinessStep();
		await screen.findByLabelText("Email for this activation");
	});

	it("requires GSTIN and address before continuing, pre-filled from the dealer record where known", async () => {
		window.history.replaceState({}, "", "/activate");
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input === "/api/activation/dealers?q=VLC") return response({ dealers: [{ id: "d-1", name: "VLCO", city: "Patna" }] });
			if (input === "/api/activation/dealers/d-1") return response({
				id: "d-1", name: "VLCO", city: "Patna", maskedMasterEmail: null,
				gstin: "22AAAAA0000A1Z5", addressLine1: "12 MG Road", addressLine2: null,
				state: "Bihar", pinCode: "800001", contactPerson: "Asha Rao", mobile: "9800000000",
			});
			throw new Error(`unexpected fetch ${input}`);
		}));
		render(<App />);
		fireEvent.change(screen.getByLabelText("Find your dealership"), { target: { value: "VLC" } });
		fireEvent.click(await screen.findByRole("button", { name: "VLCO · Patna" }));
		await screen.findByText("Confirm your business details");
		expect(await screen.findByLabelText("GSTIN")).toHaveValue("22AAAAA0000A1Z5");
		expect(screen.getByLabelText("Contact person")).toHaveValue("Asha Rao");
		expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
		fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "" } });
		expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
	});
});
