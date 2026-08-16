import type { CodeRunRecord, CodeRunViewModel, CodeVerificationCard } from "../../../../lib/code-run-view-model";
import { t } from "../../../../../shared/i18n";
import "./CodeRunPanel.css";

function runLabel(status: CodeRunRecord["status"]): string {
  switch (status) {
    case "queued": return t("reactChat.codeRunQueued");
    case "running": return t("reactChat.codeRunRunning");
    case "waiting_for_user": return t("reactChat.codeRunWaitingUser");
    case "verifying": return t("reactChat.codeRunVerifying");
    case "approval_required": return t("reactChat.codeRunApprovalRequired");
    case "completed": return t("reactChat.codeRunCompleted");
    case "failed": return t("reactChat.codeRunFailed");
    case "cancelled": return t("reactChat.codeRunCancelled");
    case "interrupted": return t("reactChat.codeRunInterrupted");
  }
}

function cardLabel(status: CodeVerificationCard["status"]): string {
  switch (status) {
    case "completed_verified": return t("reactChat.codeRunCompletedVerified");
    case "completed_no_changes": return t("reactChat.codeRunCompletedNoChanges");
    case "failed_verification": return t("reactChat.codeRunVerificationFailed");
    case "unverified": return t("reactChat.codeRunUnverified");
    case "approval_required": return t("reactChat.codeRunApprovalRequired");
    case "cancelled": return t("reactChat.codeRunCancelled");
    case "interrupted": return t("reactChat.codeRunInterrupted");
    case "failed": return t("reactChat.codeRunFailed");
  }
}

function VerificationResult({ card }: { card: CodeVerificationCard }) {
  const mutationCount = card.mutations.created.length
    + card.mutations.modified.length
    + card.mutations.deleted.length;
  return (
    <section className={`cy-code-run-card is-${card.status}`} aria-label={t("reactChat.codeVerificationResult")}>
      <header>
        <strong>{t("reactChat.codeVerificationResult")}</strong>
        <span>{cardLabel(card.status)}</span>
      </header>
      <dl>
        <dt>{t("reactChat.workspace")}</dt><dd title={card.workspaceRoot}>{card.workspaceRoot}</dd>
        <dt>{t("reactChat.fileChanges")}</dt><dd>{t("reactChat.changeCount", { count: String(mutationCount) })}</dd>
      </dl>
      {card.verification.steps.length > 0 && (
        <ol className="cy-code-run-card__steps">
          {card.verification.steps.map((step, index) => (
            <li key={`${step.type}-${index}`} className={step.passed ? "is-passed" : "is-failed"}>
              <span aria-hidden="true">{step.skipped ? "—" : step.passed ? "✓" : "!"}</span>
              <strong>{step.type}</strong>
              <small>{step.durationMs} ms</small>
            </li>
          ))}
        </ol>
      )}
      {card.warnings.length > 0 && (
        <ul className="cy-code-run-card__warnings">
          {card.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}

export function CodeRunPanel({ value }: { value: CodeRunViewModel }) {
  if (value.card) return <VerificationResult card={value.card} />;
  if (!value.run) return null;
  return (
    <section className={`cy-code-run-card is-${value.run.status}`} aria-label={t("reactChat.codeTask")}>
      <header>
        <strong>{t("reactChat.codeTask")}</strong>
        <span>{runLabel(value.run.status)}</span>
      </header>
      {value.run.errorCode && <p className="cy-code-run-card__error">{value.run.errorCode}</p>}
    </section>
  );
}
