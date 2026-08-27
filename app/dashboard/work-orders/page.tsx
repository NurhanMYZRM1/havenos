import { AppHeader } from "@/components/shell/app-header";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { WorkOrderBoard } from "@/components/work-orders/work-order-board";
import { demoStats, demoWorkOrders } from "@/lib/demo-data";

export default function WorkOrdersPage() {
  return (
    <>
      <AppHeader title="Work Orders" />
      <main className="mx-auto max-w-6xl px-5 pb-tabbar md:px-6 md:pb-24">
        <div className="hairline-b flex flex-col gap-1 pb-3 pt-7 sm:flex-row sm:items-baseline sm:justify-between md:pt-10">
          <h1 className="font-display text-[24px] font-light tracking-wide md:text-[26px]">
            Work Orders
          </h1>
          <span className="microlabel shrink-0">Tap a card action to advance</span>
        </div>
        <div className="mt-5 md:mt-6">
          <WorkOrderBoard initial={demoWorkOrders} />
        </div>
      </main>
      <MobileTabBar badgeCount={demoStats.openWorkOrders} />
    </>
  );
}
