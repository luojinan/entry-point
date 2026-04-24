import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MAX_SELECTED_SKILLS,
  type SkillSummary,
  uniqueSkillIds,
} from "@/lib/skills";

interface ChatSkillPickerProps {
  skills: SkillSummary[];
  selectedSkillIds: string[];
  onSelectedSkillIdsChange: (skillIds: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  error?: string | null;
}

export function ChatSkillPicker({
  skills,
  selectedSkillIds,
  onSelectedSkillIdsChange,
  disabled = false,
  isLoading = false,
  error = null,
}: ChatSkillPickerProps) {
  const selectedSkills = selectedSkillIds.map((skillId) => {
    const skill = skills.find((candidate) => candidate.id === skillId);
    return (
      skill ?? {
        id: skillId,
        title: skillId,
        description: "该 skill 当前不可用",
        tags: [],
        runtime: "prompt-only" as const,
      }
    );
  });

  const selectionLimitReached = selectedSkillIds.length >= MAX_SELECTED_SKILLS;
  const triggerLabel = isLoading
    ? "加载 Skills..."
    : selectedSkills.length === 0
      ? "Skills"
      : selectedSkills.length === 1
        ? selectedSkills[0]?.title || "Skills"
        : `Skills ${selectedSkills.length}/${MAX_SELECTED_SKILLS}`;

  const toggleSkill = (skillId: string, checked: boolean) => {
    if (checked) {
      if (selectionLimitReached && !selectedSkillIds.includes(skillId)) {
        return;
      }

      onSelectedSkillIdsChange(uniqueSkillIds([...selectedSkillIds, skillId]));
      return;
    }

    onSelectedSkillIdsChange(selectedSkillIds.filter((id) => id !== skillId));
  };

  return (
    <div className="min-w-0 space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
          disabled={disabled || (isLoading && skills.length === 0)}
        >
          {triggerLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              Skills {selectedSkillIds.length}/{MAX_SELECTED_SKILLS}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={selectedSkillIds.length === 0}
              onClick={() => {
                onSelectedSkillIdsChange([]);
              }}
            >
              清空已选
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {skills.length === 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                {error ||
                  (isLoading ? "正在加载 skill 列表..." : "暂无可用 skill")}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          ) : (
            <DropdownMenuGroup>
              {skills.map((skill) => {
                const checked = selectedSkillIds.includes(skill.id);
                const itemDisabled =
                  disabled || (!checked && selectionLimitReached);

                return (
                  <DropdownMenuCheckboxItem
                    key={skill.id}
                    checked={checked}
                    disabled={itemDisabled}
                    onCheckedChange={(nextChecked) => {
                      toggleSkill(skill.id, nextChecked === true);
                    }}
                  >
                    <div className="min-w-0 pr-4">
                      <div className="truncate font-medium">{skill.title}</div>
                      <div className="text-muted-foreground line-clamp-2 text-xs">
                        {skill.description}
                      </div>
                    </div>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((skill) => (
            <Badge key={skill.id} variant="outline">
              {skill.title}
            </Badge>
          ))}
        </div>
      )}

      <div className="text-muted-foreground text-xs">
        {error ||
          `最多选择 ${MAX_SELECTED_SKILLS} 个 skill，会按当前顺序注入 system prompt。`}
      </div>
    </div>
  );
}
