import type { TaskPlanPresentation } from "./run-presentation";
import { t } from "../../../../../shared/i18n";
import "./RunExperience.css";

function statusLabel(status: "pending" | "running" | "completed" | "failed"): string {
  switch (status) {
    case "pending": return t("reactChat.planPending");
    case "running": return t("reactChat.planRunning");
    case "completed": return t("reactChat.planCompleted");
    case "failed": return t("reactChat.planFailed");
  }
}

export function TaskPlanCard({ plan }: { plan: TaskPlanPresentation }) {
  return (
    <section className="cy-task-plan-card" aria-label={t("reactChat.taskPlan")}>
      <header>
        <span>{t("reactChat.taskPlan")}</span>
        {plan.title && <strong>{plan.title}</strong>}
      </header>
      <ol>
        {plan.steps.map((step) => {
          const status = step.status ?? "pending";
          return (
            <li key={step.id} className={`is-${status}`}>
              <span className="cy-task-plan-card__marker" aria-hidden="true" />
              <span>{step.title}</span>
              <small>{statusLabel(status)}</small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
