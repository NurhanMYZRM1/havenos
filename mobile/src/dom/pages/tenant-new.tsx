"use dom";

import "../polyfills";
import "../havenos.css";
import { TenantDialog } from "@/components/tenancies/tenant-dialog";
import { DomHost, type DomHostProps } from "../host";

export default function NewTenantScreen(props: DomHostProps) {
  return (
    <DomHost {...props} padded={false} sheet>
      <TenantDialog
        open
        tenant={null}
        onClose={() => void props.navigate("", "back")}
        onSaved={(x) => void props.navigate(`/tenants/view?id=${x.id}`, "replace")}
      />
    </DomHost>
  );
}
