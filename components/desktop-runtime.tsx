"use client";

import { DesktopShell } from "./desktop-shell";
import { OfflinePushRevampAnnouncement } from "./offline-push-revamp-announcement";
import { CloudBackupScheduler } from "./cloud-backup-scheduler";
import { RealityBridgeScheduler } from "./reality-bridge-scheduler";
import { WidgetScheduler } from "./widget/widget-scheduler";
import { CheckInScheduler } from "./screenshot/checkin-scheduler";
import { MediaMaintenanceScheduler } from "./media-maintenance-scheduler";
import { ShellPushRegistrar } from "./shell-push-registrar";
import { MusicProvider } from "@/lib/music-context";
import type { ThemeProfile } from "@/lib/theme-types";

/** Download and evaluate common entry pages during the splash, before the first tap.
 * Imports share webpack's module cache with the corresponding dynamic components. */
export async function preloadDesktopEntryApps(): Promise<void> {
  await import("./phone-settings-app").catch(() => undefined);
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  await import("./vn/vn-app").catch(() => undefined);
}

export function DesktopRuntime(props: {
  initialThemeProfile?: ThemeProfile;
  initialThemeAssets?: Record<string, string>;
}) {
  return <MusicProvider>
    <DesktopShell {...props} />
    <OfflinePushRevampAnnouncement />
    <CloudBackupScheduler />
    <RealityBridgeScheduler />
    <WidgetScheduler />
    <CheckInScheduler />
    <MediaMaintenanceScheduler />
    <ShellPushRegistrar />
  </MusicProvider>;
}
