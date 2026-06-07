import { TargetListPane, type TargetListPaneProps } from "../components/cleanup/TargetListPane";

type JunkCleanupPageProps = Omit<TargetListPaneProps, "activeView">;

export function JunkCleanupPage(props: JunkCleanupPageProps) {
  return <TargetListPane activeView="junk" {...props} />;
}
