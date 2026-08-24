import { useI18n } from "../lib/i18n";

/**
 * Full-screen launch / vault-switch splash: pulsing logo, sweeping light
 * bar, subtle fade. Pure CSS animation — no timers, no state.
 */
export function Splash() {
  const t = useI18n();
  return (
    <div className="markion-splash">
      <div className="markion-splash-logo">M</div>
      <div className="markion-splash-title">MARKION</div>
      <div className="markion-splash-bar">
        <div className="markion-splash-fill" />
        <div className="markion-splash-fill markion-splash-fill-delay" />
      </div>
      <div className="markion-splash-label">{t.splashOpening}</div>
    </div>
  );
}
