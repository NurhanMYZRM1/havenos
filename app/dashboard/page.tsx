import { AppHeader } from "@/components/shell/app-header";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { PropertyDashboard } from "@/components/dashboard/property-dashboard";
import { demoProperties, demoStats, demoWorkOrders } from "@/lib/demo-data";

// Demo data for the scaffold; production reads the occupancy_rollup view
// through lib/supabase/server.ts under RLS.
export default function DashboardPage() {
  return (
    <>
      <AppHeader title="Portfolio" />
      <main>
        <PropertyDashboard
          properties={demoProperties}
          stats={demoStats}
          workOrders={demoWorkOrders}
        />
      </main>
      <MobileTabBar badgeCount={demoStats.openWorkOrders} />
    </>
  );
}
