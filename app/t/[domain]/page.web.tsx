import { Monogram } from "@/components/brand/monogram";
import { isAppHost, resolveTenant } from "@/lib/tenancy";

/*
 * Landing surface for tenant custom domains (rewritten here by middleware.ts).
 *
 * Named `page.web.tsx` deliberately: the web build registers the `web.tsx`
 * page extension and picks this up, while the mobile static export does not,
 * so the native bundle omits the route entirely. The native shell is the
 * operator console and never serves tenant vanity domains — and a dynamic
 * route cannot be statically exported without forcing `dynamicParams = false`
 * on the web build too, which would break tenant routing.
 */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const host = decodeURIComponent(domain);

  const tenant =
    !isAppHost(host) && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? await resolveTenant(host)
      : null;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <div className="flex justify-center">
          <Monogram size={48} />
        </div>
        <h1 className="mt-6 font-display text-[28px] font-light tracking-wide md:text-[32px]">
          {tenant?.name ?? "Residence portal"}
        </h1>
        <p className="mt-2 text-[13px] text-ink-3">
          {tenant
            ? `Serving ${host} for ${tenant.slug}`
            : `No org claims ${host} yet — set orgs.custom_domain to activate.`}
        </p>
      </div>
    </main>
  );
}
