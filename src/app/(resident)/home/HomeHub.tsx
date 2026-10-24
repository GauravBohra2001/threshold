import Link from "next/link";
import {
  Camera,
  FolderOpen,
  Scale,
  TheaterIcon,
} from "lucide-react";

/**
 * Resident home hub (ui-design.md). A clear, large-target list of links to
 * every feature. Shown once a household exists. The Judge Mode link only
 * appears for the demo household. Semantic nav + list; each item is a real
 * link ≥44px with an icon paired with text.
 */

export interface HomeHubProps {
  residentName: string;
  /** True when this is the seeded demo household (shows the Judge Mode link). */
  isDemo: boolean;
}

interface HubLink {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export default function HomeHub({ residentName, isDemo }: HomeHubProps) {
  const links: HubLink[] = [
    {
      href: "/report",
      label: "Report a barrier",
      description: "Photograph a barrier and let the assistant route it.",
      icon: <Camera aria-hidden="true" className="h-6 w-6 shrink-0" />,
    },
    {
      href: "/vault",
      label: "Your evidence",
      description: "Photos of your equipment and home features.",
      icon: <FolderOpen aria-hidden="true" className="h-6 w-6 shrink-0" />,
    },
    {
      href: "/rights",
      label: "Rights Card",
      description: "Show your rights to shelter staff.",
      icon: <Scale aria-hidden="true" className="h-6 w-6 shrink-0" />,
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 py-8">
      <h1 className="text-[28px]">Hello, {residentName}</h1>
      <p className="mt-2 text-muted">What would you like to do?</p>

      <nav aria-label="Main features" className="mt-8">
        <ul className="flex flex-col gap-4">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-[56px] items-start gap-3 rounded-[18px] border border-line bg-surface p-4"
              >
                <span className="mt-0.5 text-accent">{link.icon}</span>
                <span className="flex flex-col">
                  <span className="text-[18px] font-bold text-ink">
                    {link.label}
                  </span>
                  <span className="text-[16px] text-muted">
                    {link.description}
                  </span>
                </span>
              </Link>
            </li>
          ))}

          {isDemo ? (
            <li>
              <Link
                href="/judge"
                className="flex min-h-[56px] items-start gap-3 rounded-[18px] border border-line bg-surface p-4"
              >
                <span className="mt-0.5 text-accent">
                  <TheaterIcon aria-hidden="true" className="h-6 w-6 shrink-0" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[18px] font-bold text-ink">
                    Judge Mode
                  </span>
                  <span className="text-[16px] text-muted">
                    Back to the demo controls and replays.
                  </span>
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
    </main>
  );
}
