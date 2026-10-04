const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIPv6(s: string): boolean {
  if (!s.includes(":") || /[^0-9a-fA-F:.]/.test(s)) return false;
  const doubles = s.split("::").length - 1;
  if (doubles > 1) return false;
  let groups = s.split(":").filter((g) => g !== "");
  const last = groups[groups.length - 1];
  if (last?.includes(".")) {
    if (!IPV4.test(last)) return false;
    groups = [...groups.slice(0, -1), "0", "0"];
  }
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return doubles === 1 ? groups.length < 8 : groups.length === 8;
}

export function isIP(input: string): 0 | 4 | 6 {
  if (IPV4.test(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}

export default { isIP };
