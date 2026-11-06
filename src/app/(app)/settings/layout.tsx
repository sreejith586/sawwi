import { Suspense } from "react";
import { SettingsTabs } from "./settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Suspense fallback={<SettingsTabs static />}>
        <SettingsTabs />
      </Suspense>
      <div className="mt-8">{children}</div>
    </div>
  );
}
