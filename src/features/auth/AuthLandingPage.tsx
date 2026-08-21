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
				<h2>Set up your account</h2>
				<p className="field-note">Already work with KITCO? Activate your account in a few quick steps.</p>
				<Button full onClick={() => navigate("/activate")}>Activate my account</Button>
				<p className="field-note">Brand new to KITCO?</p>
				<Button full variant="secondary" onClick={() => navigate("/register")}>Register my shop</Button>
			</aside>
		</div>
	</div>;
}
