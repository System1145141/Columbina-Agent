import "./RoleToggle.css";
import { t } from "../../../../shared/i18n";

/** 角色身份（与 vanilla chat/main.ts 的 AgentRole 语义一致）。 */
export type AgentRole = "columbina" | "sandrone";

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  columbina: "哥伦比娅",
  sandrone: "桑多涅",
};

export interface ModelEntry {
  id: string;
  model?: string;
  nickname?: string;
  [key: string]: unknown;
}

interface RoleToggleProps {
  currentRole: AgentRole;
  models: ModelEntry[];
  selectedModelIds: Record<AgentRole, string | null>;
  onRoleChange: (role: AgentRole) => void;
  onModelChange: (role: AgentRole, modelId: string | null) => void;
}

function roleGroup(role: AgentRole, props: RoleToggleProps) {
  const { currentRole, models, selectedModelIds, onRoleChange, onModelChange } = props;
  const active = currentRole === role;
  const roleLabel = AGENT_ROLE_LABELS[role];
  return (
    <span
      className={`cy-role-toggle__group${active ? " is-active" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      title={active ? undefined : t("reactChat.switchToRole", { role: roleLabel })}
      onClick={() => onRoleChange(role)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onRoleChange(role);
        }
      }}
    >
      <span className="cy-role-toggle__name">{roleLabel}</span>
      <select
        className="cy-role-toggle__model"
        aria-label={t("reactChat.roleModelAria", { role: roleLabel })}
        title={t("reactChat.roleModelAria", { role: roleLabel })}
        value={selectedModelIds[role] ?? ""}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onModelChange(role, event.target.value || null)}
      >
        <option value="">{t("reactChat.selectModel")}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.nickname || model.model || model.id}
          </option>
        ))}
      </select>
    </span>
  );
}

export function RoleToggle(props: RoleToggleProps) {
  return (
    <div className="cy-role-toggle" role="group" aria-label={t("reactChat.switchRole")}>
      {roleGroup("columbina", props)}
      <span className="cy-role-toggle__divider" aria-hidden="true" />
      {roleGroup("sandrone", props)}
    </div>
  );
}
