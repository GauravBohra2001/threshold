import type { ReactNode } from "react";

export interface Task {
  name: string;
  href: string;
  /** Plain-text status, e.g. "Done", "Not started", "Needs a photo". */
  status: string;
}

export interface TaskListProps {
  tasks: Task[];
  label?: string;
  /** Renders each row's link. Lets the page use next/link if it wants. */
  renderLink?: (task: Task) => ReactNode;
}

/**
 * A task list (GOV.UK pattern): each task name is an underlined link with a
 * plain-text status on the right. No all-caps status tags (they tested poorly),
 * no color-only cues (ui-design.md).
 */
export default function TaskList({ tasks, label, renderLink }: TaskListProps) {
  return (
    <ul aria-label={label} className="border-t border-line">
      {tasks.map((task) => (
        <li
          key={task.name}
          className="flex items-center justify-between gap-4 border-b border-line py-3"
        >
          {renderLink ? (
            renderLink(task)
          ) : (
            <a href={task.href} className="text-accent underline">
              {task.name}
            </a>
          )}
          <span className="text-[16px] text-muted">{task.status}</span>
        </li>
      ))}
    </ul>
  );
}
