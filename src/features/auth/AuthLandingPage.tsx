import { Button, Tabs } from "../../components/ui";
import { ActivationPage } from "../activation/ActivationPage";
import { RegisterPage } from "../activation/RegisterPage";
import { LoginPage } from "./LoginPage";

function navigate(path: string) {
	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AuthLandingPage({ pathname }: { pathname: string }) {
	const activeTab = pathname === "/activate" || pathname === "/register" ? "activate" : "signin";
	if (pathname === "/register") {
		return <div className="auth-landing">
			<Tabs items={[{ id: "signin", label: "Sign In" }, { id: "activate", label: "Activate / Register" }]} activeId={activeTab} onChange={(id) => navigate(id === "activate" ? "/activate" : "/login")} label="Sign in or activate" />
			<RegisterPage />
		</div>;
	}
	if (activeTab === "activate") {
		return <div className="auth-landing">
			<Tabs items={[{ id: "signin", label: "Sign In" }, { id: "activate", label: "Activate / Register" }]} activeId={activeTab} onChange={(id) => navigate(id === "activate" ? "/activate" : "/login")} label="Sign in or activate" />
			<ActivationPage />
		</div>;
	}
	return <div className="auth-landing">
		<Tabs items={[{ id: "signin", label: "Sign In" }, { id: "activate", label: "Activate / Register" }]} activeId={activeTab} onChange={(id) => navigate(id === "activate" ? "/activate" : "/login")} label="Sign in or activate" />
		<div className="auth-landing-split">
			<div className="auth-landing-primary"><LoginPage /></div>
			<aside className="auth-landing-promo">
				<p className="auth-kicker">First time here?</p>
				<h2>Activate your dealership</h2>
				<p className="field-note">If KITCO already has your dealership on file, activate it in a few steps. No access code needed.</p>
				<Button full onClick={() => navigate("/activate")}>Activate Dealership</Button>
				<p className="field-note">New to KITCO?</p>
				<Button full variant="secondary" onClick={() => navigate("/register")}>Register Dealership</Button>
			</aside>
		</div>
	</div>;
}
