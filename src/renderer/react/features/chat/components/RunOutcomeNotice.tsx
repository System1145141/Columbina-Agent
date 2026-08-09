import { t } from "../../../../../shared/i18n";
import "./RunExperience.css";

export type RunOutcomeKind = "direct_fallback" | "partial" | "failed";

function outcomeMessage(kind: RunOutcomeKind): string {
  switch (kind) {
    case "direct_fallback": return t("reactChat.outcomeDirectFallback");
    case "partial": return t("reactChat.outcomePartial");
    case "failed": return t("reactChat.outcomeFailed");
  }
}

export function RunOutcomeNotice({
  kind,
  message,
}: {
  kind: RunOutcomeKind;
  message?: string;
}) {
  return <div className={`cy-run-outcome cy-run-outcome--${kind}`} role="status">{message ?? outcomeMessage(kind)}</div>;
}
