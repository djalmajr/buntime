import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useProjectReleases } from "~/hooks/use-projects";
import { Skeleton } from "./ui/skeleton";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineDot,
  TimelineHeader,
  TimelineItem,
  TimelineTime,
  TimelineTitle,
} from "./ui/timeline";

interface ReleaseTimelineProps {
  folder?: string;
  project: string;
}

function TimelineSkeleton() {
  return (
    <div className="space-y-8">
      {[1, 2, 3].map((i) => (
        <div className="flex gap-3" key={i}>
          <Skeleton className="h-4 w-4 rounded-full shrink-0 mt-1" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReleaseTimeline({ folder = "", project }: ReleaseTimelineProps) {
  const { i18n } = useTranslation();
  const releases$ = useProjectReleases(project, folder, i18n.language);

  if (releases$.isPending) {
    return <TimelineSkeleton />;
  }

  if (releases$.isError || !releases$.data?.releases?.length) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(i18n.language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Timeline>
      {releases$.data.releases.map((release, index) => (
        <TimelineItem key={release.slug}>
          <TimelineDot />
          <TimelineConnector />
          <TimelineContent>
            <TimelineHeader>
              <TimelineTitle>
                <Link
                  className="hover:underline text-primary"
                  params={{ project, _splat: release.slug }}
                  to="/$project/$"
                >
                  {release.name}
                </Link>
              </TimelineTitle>
              <TimelineTime>{formatDate(release.date)}</TimelineTime>
            </TimelineHeader>
            {release.summary && (
              <TimelineDescription className="mt-2">{release.summary}</TimelineDescription>
            )}
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
