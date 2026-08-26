import { Button, Tabs } from "../../components/ui";
import { RegisterPage } from "../activation/RegisterPage";
import { LoginPage } from "./LoginPage";

function navigate(path: string) {
	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

const TABS = [{ id: "signin", label: "Sign In" }, { id: "register", label: "Register" }];

/** v5 has two public doors and no third: sign in with KITCO-issued credentials, or
 *  apply to become a dealer. v4's "Activate" tab is gone -- it let anyone search the
 *  dealer list, claim an unactivated shop with their own email and be signed in as that
 *  dealership, and 135 of the 136 live dealers are still unactivated. Registration
 *  remains an application that only an admin can approve. */
export function AuthLandingPage({ pathname }: { pathname: string }) {
	const activeTab = pathname === "/register" ? "register" : "signin";
	const tabs = <Tabs items={TABS} activeId={activeTab} onChange={(id) => navigate(id === "register" ? "/register" : "/login")} label="Sign in or register" />;

	if (activeTab === "register") return <div className="auth-landing">{tabs}<RegisterPage /></div>;

	return <div className="auth-landing">
		{tabs}
		<div className="auth-landing-split">
			<div className="auth-landing-primary"><LoginPage /></div>
			<aside className="auth-landing-promo">
				<p className="auth-kicker">No sign-in details yet?</p>
				<h2>KITCO issues your account</h2>
				<p className="field-note">Existing dealers: KITCO sends you a Dealer Code and a first-time password. Contact your KITCO representative if you have not received them.</p>
				<p className="field-note">Brand new to KITCO?</p>
				<Button full variant="secondary" onClick={() => navigate("/register")}>Register my shop</Button>
			</aside>
		</div>
	</div>;
}
