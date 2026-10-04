"use dom";

import "../polyfills";
import "../havenos.css";
import { NewMaintenanceDialog } from "@/components/maintenance/maintenance-form";
import { DomHost, type DomHostProps } from "../host";

export default function NewMaintenanceScreen(props: DomHostProps) {
  const q = new URLSearchParams(props.search);
  const defaults = { propertyId: q.get("propertyId") ?? undefined, spaceId: q.get("spaceId"), tenantId: q.get("tenantId") };
  return (
    <DomHost {...props} padded={false} sheet>
      <NewMaintenanceDialog open defaults={defaults} onClose={() => void props.navigate("", "back")} />
    </DomHost>
  );
}
