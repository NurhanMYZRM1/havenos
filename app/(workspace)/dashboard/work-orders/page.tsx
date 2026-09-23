"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui/layout";

/**
 * "Work Orders" is now part of Maintenance. Old links land here and are sent
 * on. (The web build also has a permanent server redirect in next.config.ts;
 * this page covers the static desktop build, which has no server.)
 */
export default function WorkOrdersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/maintenance");
  }, [router]);
  return <Loading />;
}
