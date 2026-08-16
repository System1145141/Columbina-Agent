import "./ClineModeSwitch.css";
import { t } from "../../../../../shared/i18n";

export type ClineMode = "plan" | "act";

export function ClineModeSwitch({
  value,
  disabled = false,
  onChange,
}: {
  value: ClineMode;
  disabled?: boolean;
  onChange: (mode: ClineMode) => void;
}) {
  return (
    <div className="cy-cline-mode-switch" role="group" aria-label={t("reactChat.clineModeGroupAria")}>
      {(["plan", "act"] as const).map((mode) => (
        <button
          type="button"
          key={mode}
          className={value === mode ? "is-active" : ""}
          aria-pressed={value === mode}
          disabled={disabled}
          title={mode === "plan" ? t("reactChat.clinePlanTitle") : t("reactChat.clineActTitle")}
          onClick={() => onChange(mode)}
        >
          {mode === "plan" ? "Plan" : "Act"}
        </button>
      ))}
    </div>
  );
}
