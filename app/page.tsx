import { DashboardApp } from "../dashboard/components/dashboard-app";

export const dynamic = "force-dynamic";

export default function Home() {
  return <DashboardApp allowDevelopmentShell={process.env.NODE_ENV !== "production"} />;
}
