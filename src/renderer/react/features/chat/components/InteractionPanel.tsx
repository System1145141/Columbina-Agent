import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  buildAskSubmission,
  createAskDrafts,
  isAskComplete,
  selectAskOption,
  updateAskCustomText,
  type AskUserInteraction,
  type AskUserQuestion,
  type PermissionInteraction,
} from "./run-presentation";
import { t } from "../../../../../shared/i18n";
import "./RunExperience.css";

function PanelShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="cy-interaction-panel" aria-label={title}>
      {children}
    </section>
  );
}

export function AskUserPanel({
  interaction,
  disabled = false,
  onAnswer,
  onIgnore,
}: {
  interaction: AskUserInteraction;
  disabled?: boolean;
  onAnswer?: (answer: unknown) => void;
  onIgnore?: () => void;
}) {
  const questions: AskUserQuestion[] = interaction.questions ?? [{
    id: "choice",
    question: interaction.question,
    options: interaction.options,
    allowCustomInput: interaction.allowCustomInput,
  }];
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState(() => createAskDrafts(questions));
  useEffect(() => {
    setPage(0);
    setDrafts(createAskDrafts(questions));
  }, [interaction.id]);
  const current = questions[Math.min(page, questions.length - 1)];
  const currentDraft = drafts[current.id] ?? { source: null, optionIds: [], customText: "" };
  const canSubmit = isAskComplete(questions, drafts);
  const submit = () => {
    if (!canSubmit) return;
    if (interaction.responseKind === "submission") {
      onAnswer?.(buildAskSubmission(interaction, drafts));
      return;
    }
    if (interaction.responseKind === "clarification") {
      onAnswer?.({
        requestId: interaction.id,
        answers: questions.map((question) => {
          const draft = drafts[question.id];
          return draft.source === "custom"
            ? { field: question.id, customText: draft.customText.trim() }
            : { field: question.id, selectedValues: draft.optionIds };
        }),
      });
      return;
    }
    onAnswer?.(currentDraft.source === "custom" ? currentDraft.customText.trim() : currentDraft.optionIds[0]);
  };

  return (
    <PanelShell title={t("reactChat.asking")}>
      <div className="cy-interaction-panel__heading">
        <span className="cy-interaction-panel__status">{t("reactChat.asking")}</span>
        {questions.length > 1 && (
          <nav className="cy-interaction-panel__pager" aria-label={t("reactChat.switchQuestion")}>
            <button type="button" aria-label={t("reactChat.previousQuestion")} disabled={disabled || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>‹</button>
            <span className="cy-interaction-panel__page">{page + 1} / {questions.length}</span>
            <button type="button" aria-label={t("reactChat.nextQuestion")} disabled={disabled || page === questions.length - 1} onClick={() => setPage((value) => Math.min(questions.length - 1, value + 1))}>›</button>
          </nav>
        )}
      </div>
      {interaction.intro && <p className="cy-interaction-panel__intro">{interaction.intro}</p>}
      <p className="cy-interaction-panel__question">{current.question}</p>
      <div className="cy-interaction-panel__options" role={current.multiple ? "group" : "radiogroup"} aria-label={current.question}>
        {current.options.map((option, index) => (
          <button
            type="button"
            key={option.id}
            className={currentDraft.optionIds.includes(option.id) ? "is-selected" : ""}
            role={current.multiple ? "checkbox" : "radio"}
            aria-checked={currentDraft.optionIds.includes(option.id)}
            disabled={disabled}
            onClick={() => {
              setDrafts((values) => selectAskOption(values, current, option.id));
            }}
          >
            <span className="cy-interaction-panel__option-index">{index + 1}.</span>
            <span>
              <strong>{option.label}</strong>
              {option.description && <small>{option.description}</small>}
            </span>
          </button>
        ))}
      </div>
      <label className="cy-interaction-panel__custom-answer">
        <span>{t("reactChat.otherAnswer")}</span>
        <input
          value={currentDraft.customText}
          disabled={disabled}
          placeholder={current.freeTextPlaceholder ?? t("reactChat.customAnswerPlaceholder")}
          onChange={(event) => setDrafts((values) => updateAskCustomText(values, current.id, event.target.value))}
        />
      </label>
      {questions.length > 1 && (
        <div className="cy-interaction-panel__question-index" aria-label={t("reactChat.questionProgress")}>
          {questions.map((question, index) => {
            const draft = drafts[question.id];
            const answered = draft?.source === "option" || draft?.source === "custom";
            return <button type="button" key={question.id} className={page === index ? "is-current" : ""} disabled={disabled} onClick={() => setPage(index)}>{answered ? "✓" : "○"} {index + 1}</button>;
          })}
        </div>
      )}
      <div className="cy-interaction-panel__actions">
        {interaction.responseKind === "choice" && interaction.source !== "code" && <button type="button" disabled={disabled} onClick={onIgnore}>{t("reactChat.ignore")}</button>}
        <button type="button" className="is-primary" disabled={disabled || !canSubmit} onClick={submit}>{questions.length > 1 ? t("reactChat.submitAll") : t("reactChat.submit")}</button>
      </div>
    </PanelShell>
  );
}

export function PermissionPanel({
  interaction,
  disabled = false,
  onDecision,
}: {
  interaction: PermissionInteraction;
  disabled?: boolean;
  onDecision?: (allowed: boolean) => void;
}) {
  return (
    <PanelShell title={t("reactChat.gettingApproval")}>
      <div className="cy-interaction-panel__heading">
        <span className="cy-interaction-panel__status">{t("reactChat.gettingApproval")}</span>
      </div>
      <p className="cy-interaction-panel__question">{interaction.summary}</p>
      <dl className="cy-interaction-panel__metadata">
        {interaction.workspaceName && <><dt>{t("reactChat.workspace")}</dt><dd>{interaction.workspaceName}</dd></>}
        {interaction.targetPath && <><dt>{t("reactChat.target")}</dt><dd title={interaction.targetPath}>{interaction.targetPath}</dd></>}
      </dl>
      <div className="cy-interaction-panel__actions">
        <button type="button" disabled={disabled} onClick={() => onDecision?.(false)}>{t("reactChat.deny")}</button>
        <button type="button" className="is-primary" disabled={disabled} onClick={() => onDecision?.(true)}>{t("reactChat.allow")}</button>
      </div>
    </PanelShell>
  );
}
