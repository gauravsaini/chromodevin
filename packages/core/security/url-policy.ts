/**
 * URL Policy and Navigation Validator for Kevin.
 * Enforces secure navigation boundaries and prevents SSRF, private network pivoting,
 * and dangerous protocol execution.
 */

export interface NavigationUrlPolicyOptions {
  allowPrivateNetwork?: boolean;
  allowFile?: boolean;
  allowBlob?: boolean;
}

export interface NavigationUrlPolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks whether a hostname refers to a private network address, loopback,
 * internal domain, or local machine interface.
 */
export function isPrivateHostname(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') {
    return false;
  }
  const cleanHost = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost === 'local' ||
    cleanHost.endsWith('.local') ||
    cleanHost === 'internal' ||
    cleanHost.endsWith('.internal')
  ) {
    return true;
  }

  // IPv6 loopback / unspecified / link-local / unique-local
  if (
    cleanHost === '::1' ||
    cleanHost === '::' ||
    cleanHost === '0:0:0:0:0:0:0:1' ||
    cleanHost === '0:0:0:0:0:0:0:0' ||
    cleanHost.startsWith('fc') ||
    cleanHost.startsWith('fd') ||
    cleanHost.startsWith('fe80:')
  ) {
    return true;
  }

  // IPv4 loopback (127.x.x.x)
  if (/^127(?:\.\d{1,3}){1,3}$/.test(cleanHost)) {
    return true;
  }

  // IPv4 private Class A (10.x.x.x)
  if (/^10(?:\.\d{1,3}){1,3}$/.test(cleanHost)) {
    return true;
  }

  // IPv4 private Class C (192.168.x.x)
  if (/^192\.168(?:\.\d{1,3}){1,2}$/.test(cleanHost)) {
    return true;
  }

  // IPv4 private Class B (172.16.x.x - 172.31.x.x)
  const match172 = cleanHost.match(/^172\.(\d{1,3})(?:\.\d{1,3}){1,2}$/);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  // IPv4 link-local (169.254.x.x) and unspecified (0.0.0.0 / 0.x)
  if (/^169\.254(?:\.\d{1,3}){1,2}$/.test(cleanHost) || /^0(?:\.\d{1,3}){1,3}$/.test(cleanHost)) {
    return true;
  }

  return false;
}

/**
 * Validates whether a given URL is allowed for browser navigation under security policy.
 */
export function isAllowedNavigationUrl(
  url: string,
  options: NavigationUrlPolicyOptions = {}
): NavigationUrlPolicyResult {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { allowed: false, reason: 'URL cannot be empty' };
  }

  // Reject URLs containing whitespace or ASCII control characters
  if (/[\s\x00-\x1F\x7F]/.test(url)) {
    return { allowed: false, reason: 'URL contains whitespace or control characters' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  const protocol = parsed.protocol.toLowerCase();

  if (protocol === 'file:') {
    if (!options.allowFile) {
      return { allowed: false, reason: 'Navigation to file: URLs is blocked' };
    }
    return { allowed: true };
  }

  if (protocol === 'blob:') {
    if (!options.allowBlob) {
      return { allowed: false, reason: 'Navigation to blob: URLs is blocked' };
    }
    return { allowed: true };
  }

  if (protocol === 'javascript:') {
    return { allowed: false, reason: 'Navigation to javascript: URLs is blocked' };
  }

  if (protocol === 'data:') {
    return { allowed: false, reason: 'Navigation to data: URLs is blocked' };
  }

  if (
    protocol === 'chrome:' ||
    protocol === 'chrome-extension:' ||
    protocol === 'devtools:' ||
    protocol === 'about:'
  ) {
    return { allowed: false, reason: `Navigation to ${protocol} URLs is blocked` };
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    return { allowed: false, reason: `Disallowed URL protocol: "${protocol}"` };
  }

  if (!parsed.hostname) {
    return { allowed: false, reason: 'URL is missing a valid hostname' };
  }

  if (!options.allowPrivateNetwork && isPrivateHostname(parsed.hostname)) {
    return {
      allowed: false,
      reason: `Navigation to private network address (${parsed.hostname}) is blocked`
    };
  }

  return { allowed: true };
}

/**
 * Asserts that a URL is allowed for navigation, throwing an Error if blocked.
 */
export function assertAllowedNavigationUrl(
  url: string,
  options?: NavigationUrlPolicyOptions
): void {
  const result = isAllowedNavigationUrl(url, options);
  if (!result.allowed) {
    throw new Error(result.reason || 'Navigation URL is not allowed');
  }
}
