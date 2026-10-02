import { installOwnedAppRun } from './appimage-policy.mjs';

// app-builder-lib 26.16.1 writes stock AppRun before copying appOutDir to its
// AppImage staging tree. A project-owned AppRun here overwrites that template;
// archive policy verification below the build gate checks the actual result.
export default function afterPack(context) {
  installOwnedAppRun(context);
}
