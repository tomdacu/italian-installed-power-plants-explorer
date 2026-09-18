import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { TitleBar } from "@/components/layout/TitleBar";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { SyncPage } from "@/pages/SyncPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { CredentialsPage } from "@/pages/CredentialsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { Splash } from "@/components/ui/Splash";
import { useCredentialStatus } from "@/hooks/useMetadata";
import { ONBOARDING_KEY } from "@/lib/constants";

function RootRedirect() {
  const status = useCredentialStatus();
  if (status.isLoading) return <Splash />;
  // A backend error is not "not configured" — land on the dashboard where the
  // offline state is visible instead of forcing new users into onboarding.
  const onboarded = localStorage.getItem(ONBOARDING_KEY) === "1";
  if (!onboarded && status.data && !status.data.configured) {
    return <Navigate to="/welcome" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <TitleBar />
      <div className="min-h-0 flex-1">
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<RootRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/credentials" element={<CredentialsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="/welcome" element={<OnboardingPage />} />
        </Routes>
      </div>
    </div>
  );
}
